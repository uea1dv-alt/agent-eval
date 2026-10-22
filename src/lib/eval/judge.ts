import { describeError } from '@/lib/errors'
import { DEFAULT_PROVIDER_ID, getProvider, type TokenUsage } from '@/lib/providers'
import { JUDGE_MAX_SCORE, parseJudgeOutput } from './parse-judge'

// 解析逻辑单独放在 ./parse-judge.ts —— 那块要脱离服务单独测，避免这里拖进 provider 依赖
export { JUDGE_MAX_SCORE, parseJudgeOutput }

/**
 * LLM-as-judge：让一个模型给另一个模型的回答打分。
 *
 * 为什么需要它：评测要给每条回答一个可比较的数字。人工打分准确但不可扩展，
 * 字符串相似度（BLEU / ROUGE）对「意思对但措辞不同」完全无能。
 * 用模型打分是目前开放式回答唯一能规模化的办法。
 *
 * 它**不完美**，所以有三条约束必须写死在代码里，而不是靠自觉：
 *   1. judge 模型必须和被评模型**不同** —— 模型给自己的输出打分有系统性的偏好偏差
 *   2. judge 的输出要**容错解析** —— 它经常在 JSON 外面裹一层 ```json 或一句解释
 *   3. 解析失败**不能当成 0 分** —— 那是把「没测出来」和「答得差」混为一谈，
 *      会把两个 prompt 版本的对比结果拉出假差距
 */

/** judge 默认用能力更强的模型。被判的是便宜模型时，这样最能拉开判分质量 */
export const DEFAULT_JUDGE_MODEL = 'deepseek-v4-pro'

export interface JudgeInput {
  judgeModel: string
  providerId?: string
  /** 数据集里的题目 */
  question: string
  /** 参考答案。可选 —— 没有时 judge 只能按自己的知识判断 */
  reference?: string | null
  /** 待评的被测模型输出 */
  answer: string
}

export interface JudgeResult {
  /** 0-10 的整数。判分失败时为 null —— 绝不能退化成 0 */
  score: number | null
  /** judge 给的理由。解析失败时塞原始输出，方便事后排查 */
  reason: string | null
  usage: TokenUsage
  latencyMs: number
  /** 判分失败的原因（模型调用失败，或输出解析不出来） */
  error?: string
}

/**
 * 挑一个和被测模型不同的 judge。
 *
 * 为什么不让调用方自己保证：这个约束一旦被绕过，**不会报错**，
 * 只会让对比结果悄悄偏向「自己人」。所以放在这里强制兜底。
 */
export function pickJudgeModel(testedModel: string, preferred = DEFAULT_JUDGE_MODEL): string {
  if (preferred !== testedModel) return preferred

  // 首选正好就是被测模型 —— 从同一 provider 里另找一个
  const provider = getProvider(DEFAULT_PROVIDER_ID)
  const alternative = provider.models.find((m) => m.id !== testedModel)
  // 只有一个模型可选时只能退让，但要让人看见这件事
  if (!alternative) {
    console.warn(`[judge] 没有第二个模型可用，judge 和被评模型都是 ${testedModel}`)
    return preferred
  }
  return alternative.id
}

/** judge 的系统提示词。单独拎出来是为了能在页面上展示「分数是怎么来的」 */
export const JUDGE_SYSTEM_PROMPT = `你是一个严格的评审。你要根据题目和参考答案（如果提供），给「待评回答」打分。

评分标准（0 到 10 的整数）：
- 10：完全正确，直接回答了问题，没有多余或错误的信息
- 7-9：正确且有帮助，但有轻微冗余或小瑕疵
- 4-6：部分正确，遗漏了关键点，或有明显的不准确
- 1-3：大部分错误，只有零星相关内容
- 0：完全错误、答非所问，或拒绝回答

判分规则：
- 只看回答是否解决了题目。不要因为文风、长短、格式而加减分
- 提供了参考答案时以它为准；没有时按你自己的知识判断
- 回答里有具体的数字、结论时，要核对它们对不对，不要被自信的语气骗过去

输出格式：只输出下面这一段 JSON，前后不要有任何别的文字。
{"score": <0 到 10 的整数>, "reason": "<一句话说明为什么给这个分>"}`

function buildUserPrompt(input: Pick<JudgeInput, 'question' | 'reference' | 'answer'>): string {
  return [
    '## 题目',
    input.question,
    '',
    '## 参考答案',
    input.reference?.trim() ? input.reference : '（未提供，请按你自己的知识判断）',
    '',
    '## 待评回答',
    input.answer.trim() ? input.answer : '（空回答）',
  ].join('\n')
}

/**
 * 给一条回答打分。
 *
 * 这个函数**不碰数据库**，和 provider 层一样的规矩：它只负责「调模型、解析结果」。
 * 落库由 API 路由负责。
 *
 * 它**不抛异常**（除非参数本身不合法）：判分失败也是评测的一部分数据，
 * 返回 score=null + error 让调用方原样记账，比让整批评测崩掉有价值得多。
 */
export async function judgeAnswer(input: JudgeInput): Promise<JudgeResult> {
  const provider = getProvider(input.providerId ?? DEFAULT_PROVIDER_ID)

  let result
  try {
    result = await provider.chat({
      model: input.judgeModel,
      system: JUDGE_SYSTEM_PROMPT,
      prompt: buildUserPrompt(input),
      // 判分要稳定复现 —— 温度开高的话，同一条回答两次能打 7 分和 9 分，
      // 那样两个 prompt 版本的分数差就分不清是版本差异还是采样噪声
      temperature: 0,
      // 关掉 thinking：判分是短任务，思考链只会让每条用例更慢更贵
      thinking: false,
    })
  } catch (err) {
    return {
      score: null,
      reason: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: 0,
      error: `judge 调用失败：${describeError(err)}`,
    }
  }

  try {
    const { score, reason } = parseJudgeOutput(result.text)
    return {
      score,
      reason,
      usage: result.usage,
      latencyMs: result.latencyMs,
    }
  } catch (err) {
    // 关键：score 保持 null，原始输出留在 reason 里。
    // 这样分数统计会跳过这条（而不是算它 0 分），但人还能看到模型到底说了什么
    return {
      score: null,
      reason: result.text.slice(0, 2000),
      usage: result.usage,
      latencyMs: result.latencyMs,
      error: describeError(err),
    }
  }
}
