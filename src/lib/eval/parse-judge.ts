import { z } from 'zod'

/**
 * judge 输出的解析器。
 *
 * 为什么单独一个文件：这是整条评测链路里最该单独测的一块 ——
 * 它面对的是**不可控的自然语言输出**，而它的失败是静默的
 * （分数变 null，或者更糟：退化成 0 分，把两个版本的对比结果拉出假差距）。
 * 拆出来之后可以直接拿字符串喂它，不用起服务、不用花钱调模型。
 */

/** 评分上限。0-10 比 0-100 好用：模型对百分制的刻度把握很差，总是给 70-85 */
export const JUDGE_MAX_SCORE = 10

/** judge 输出的期望形状 */
const judgePayloadSchema = z.object({
  score: z.number(),
  reason: z.string(),
})

/**
 * 从 judge 的原始输出里抠出分数和理由。
 *
 * 为什么要容错：即使提示词写了「只输出 JSON」，模型仍然会时不时给出
 * ```json 包裹、前后加一句「好的，我的评分是」、或者 score 写成字符串 "8"。
 * 这不是模型不听话，是它的输出分布本来就在「严格格式」和「自然语言」之间滑动。
 * 解析器必须扛得住，否则评测会因为一堆本可避免的解析失败而丢掉数据。
 *
 * 解析不出来时**抛异常** —— 调用方据此把 score 记成 null，而不是 0。
 */
export function parseJudgeOutput(raw: string): { score: number; reason: string } {
  // 1. 去掉 markdown 代码围栏（```json ... ``` 或 ``` ... ```）
  let text = raw.trim()
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')

  // 2. 先按整体解析；不成的话退一步，只取第一个 { 到最后一个 } 之间的内容
  //    （模型在 JSON 前后加了解释性文字时走这条）
  let candidate = text
  try {
    JSON.parse(candidate)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`judge 输出里找不到 JSON：${raw.slice(0, 200)}`)
    }
    candidate = text.slice(start, end + 1)
  }

  let json: unknown
  try {
    json = JSON.parse(candidate)
  } catch {
    throw new Error(`judge 输出的 JSON 不合法：${raw.slice(0, 200)}`)
  }

  // 3. score 可能被写成字符串。先归一化成数字再交给 zod
  if (json && typeof json === 'object' && 'score' in json) {
    const value = (json as { score: unknown }).score
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      ;(json as { score: unknown }).score = Number(value)
    }
  }

  const parsed = judgePayloadSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`judge 输出缺少 score / reason：${raw.slice(0, 200)}`)
  }

  // 4. 四舍五入 + 夹到 0-10。模型偶尔给 8.5 或 -1
  const score = Math.min(JUDGE_MAX_SCORE, Math.max(0, Math.round(parsed.data.score)))
  return { score, reason: parsed.data.reason.trim() }
}
