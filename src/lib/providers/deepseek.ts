import { createDeepSeek } from '@ai-sdk/deepseek'
import { generateText, stepCountIs, streamText, tool as sdkTool } from 'ai'
import type { LanguageModelUsage } from 'ai'
import { describeError } from '@/lib/errors'
import type {
  AgentEvent,
  AgentParams,
  AgentTool,
  LLMCallParams,
  LLMCallResult,
  LLMProvider,
  ModelInfo,
  ReasoningEffort,
  TokenUsage,
} from './types'

/**
 * DeepSeek provider 实现。
 *
 * 这是全项目**唯一**读取 DEEPSEEK_API_KEY 的地方。
 * 别处要调模型，一律走 LLMProvider 接口，不要自己 new 客户端。
 */

/**
 * 可用模型。
 *
 * 踩坑记录：deepseek-chat / deepseek-reasoner 这两个老别名已于 2026-07-24 下线，
 * 现在必须用 deepseek-flash / deepseek-v4-pro。网上教程基本还写着老名字，照抄会 404。
 */
const MODELS: ModelInfo[] = [
  {
    id: 'deepseek-flash',
    label: 'DeepSeek V4.1 Flash',
    supportsThinking: true,
    supportsVision: true,
    description: '快且便宜，适合日常迭代和批量跑评测',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    supportsThinking: true,
    supportsVision: false,
    description: '能力更强、更贵，适合难题；不支持图片输入',
  },
]

// 惰性初始化：不在模块加载时读环境变量。
// 否则 `next build` 阶段就会因为拿不到 key 而炸掉。
let cached: ReturnType<typeof createDeepSeek> | null = null

function getClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error('缺少环境变量 DEEPSEEK_API_KEY。请复制 .env.example 为 .env 并填入 key。')
  }
  cached ??= createDeepSeek({ apiKey })
  return cached
}

/**
 * 采样参数的公共部分：chat 和 runAgent 共用。
 *
 * 为什么要抽出来：这两条路径如果各写一份，改了一处忘了另一处，
 * 就会出现「单次调用温度有效、agent 里温度被忽略」这种幽灵 bug。
 */
function samplingOptions(params: {
  thinking?: boolean
  temperature?: number
  reasoningEffort?: ReasoningEffort
}) {
  const thinking = params.thinking ?? false
  return {
    // 关键：thinking 开启时，DeepSeek 会完全忽略 temperature 和 topP。
    // 与其传一个「看起来生效其实被丢弃」的值，不如干脆不传 —— 免得误导。
    temperature: thinking ? undefined : params.temperature,
    providerOptions: {
      deepseek: {
        // DeepSeek V4 默认是开启 thinking 的。我们显式传值，让行为可预测：
        // 关掉 thinking 更快更便宜，而且 temperature 才有效。
        thinking: { type: thinking ? ('enabled' as const) : ('disabled' as const) },
        ...(thinking && params.reasoningEffort
          ? { reasoningEffort: params.reasoningEffort }
          : {}),
      },
    },
  }
}

/** 把 AI SDK 的 usage 转成我们自己的 TokenUsage。字段名对齐，但要处理 undefined。 */
function toUsage(usage: LanguageModelUsage): TokenUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
    // 注意路径：AI SDK 7 把细节字段收进了 outputTokenDetails，
    // 不是顶层的 usage.reasoningTokens。写错不会报错，只会静默拿到 undefined。
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
  }
}

async function chat(params: LLMCallParams): Promise<LLMCallResult> {
  const startedAt = performance.now()

  const result = await generateText({
    model: getClient()(params.model),
    system: params.system,
    prompt: params.prompt,
    ...samplingOptions(params),
    maxOutputTokens: params.maxOutputTokens,
  })

  const latencyMs = Math.round(performance.now() - startedAt)

  return {
    text: result.text,
    // 是 reasoningText（字符串），不是 reasoning（数组，装的是各种 part）
    reasoningText: result.reasoningText,
    finishReason: result.finishReason,
    usage: toUsage(result.usage),
    latencyMs,
  }
}

/**
 * 多步 agent 循环。
 *
 * 骨架：跑模型 → 模型说要调工具 → SDK 自动执行工具 → 把结果拼回消息再跑一轮，
 * 直到模型给出最终答案，或者步数用光（`stopWhen: stepCountIs`）。
 *
 * **AI SDK 7 的坑（写错不报错，静默失效）**：
 *   - `maxSteps` 这个参数已经删了 → 用 `stopWhen: stepCountIs(n)`
 *   - `result.fullStream` 已废弃 → 是 `result.stream`
 *   - 流式增量的正文在 `part.text`，**不是 `part.delta`**
 *   - `tool()` 的入参 schema 字段叫 `inputSchema`，不是 `parameters`
 *
 * 这个函数**不碰数据库**。它只负责跑模型、调工具、往外抛事件，
 * 落库是 API 路由的事 —— provider 层保持纯粹，换厂商时才好替换。
 */
async function* runAgent(params: AgentParams, tools: AgentTool[]): AsyncIterable<AgentEvent> {
  // toolCallId → 这次工具执行的**真实**耗时（毫秒）。
  // 为什么必须在 execute 里量：如果靠「我们观察到 tool-call / tool-result
  // 两个流事件的时刻」去夹，量出来的就包含了**我们自己读流有多慢**。
  // 这个循环的消费方是 API 路由，它中间会去写数据库 —— 写库期间不读流，
  // 时间就被算进工具头上了（实测纯算术的工具报过 1560ms）。
  // 在 execute 里面量，量的是工具本身，跟消费方快慢无关。
  const toolLatency = new Map<string, number>()

  // 把我们的 AgentTool 翻译成 SDK 要的形状。
  // 这一步就是 adapter 层的价值：SDK 的类型只在这个文件里出现。
  const sdkTools = Object.fromEntries(
    tools.map((t) => [
      t.name,
      sdkTool({
        description: t.description,
        inputSchema: t.inputSchema,
        // 第二个参数是 SDK 给的执行上下文，里面有 toolCallId。
        // 模型一轮可以调多个工具，耗时必须按 id 存，不能按工具名（同名就串了）。
        execute: async (input: unknown, options: { toolCallId: string }) => {
          const startedAt = performance.now()
          try {
            return await t.execute(input)
          } finally {
            // 放 finally：工具抛异常时也要把耗时留下，失败的那次同样值得记录
            toolLatency.set(options.toolCallId, Math.round(performance.now() - startedAt))
          }
        },
      }),
    ]),
  )

  // 每一步的正文/思维链要自己攒 —— 流里只有增量，没有「这一步的完整文本」
  let step = 0
  let stepStartedAt = performance.now()
  let stepText = ''
  let stepReasoning = ''
  let finalText = ''

  try {
    const result = streamText({
      model: getClient()(params.model),
      system: params.system,
      prompt: params.prompt,
      tools: sdkTools,
      // 步数上限。没有它，模型在工具之间来回打转能把额度烧光。
      stopWhen: stepCountIs(params.maxSteps),
      ...samplingOptions(params),
      maxOutputTokens: params.maxOutputTokens,
    })

    for await (const part of result.stream) {
      switch (part.type) {
        case 'start-step':
          step += 1
          stepStartedAt = performance.now()
          stepText = ''
          stepReasoning = ''
          yield { type: 'step_start', step }
          break

        case 'text-delta':
          stepText += part.text
          yield { type: 'text_delta', text: part.text }
          break

        case 'reasoning-delta':
          stepReasoning += part.text
          yield { type: 'reasoning_delta', text: part.text }
          break

        case 'tool-call':
          yield {
            type: 'tool_call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input,
          }
          break

        case 'tool-result': {
          const latencyMs = toolLatency.get(part.toolCallId)
          toolLatency.delete(part.toolCallId)
          yield {
            type: 'tool_result',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: part.output,
            latencyMs: latencyMs ?? 0,
          }
          break
        }

        // 工具抛异常时 SDK 抛的是这个事件，不是 tool-result。
        // 失败也要记录 —— 这是 Stage 0 就定下的原则。
        case 'tool-error': {
          const latencyMs = toolLatency.get(part.toolCallId)
          toolLatency.delete(part.toolCallId)
          yield {
            type: 'tool_result',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: null,
            error: describeError(part.error),
            latencyMs: latencyMs ?? 0,
          }
          break
        }

        case 'finish-step':
          // 最后一步的正文就是这次运行的最终答案。
          // 只在非空时覆盖：模型可能一步都没输出正文就撞上步数上限，
          // 那种情况下保留上一轮的文本比清空更有用。
          if (stepText) finalText = stepText
          yield {
            type: 'step_end',
            step,
            text: stepText,
            reasoningText: stepReasoning || undefined,
            finishReason: part.finishReason,
            usage: toUsage(part.usage),
            latencyMs: Math.round(performance.now() - stepStartedAt),
          }
          break

        case 'finish':
          yield {
            type: 'done',
            text: finalText,
            usage: toUsage(part.totalUsage),
            stepCount: step,
          }
          break

        // SDK 把模型侧的报错也做成流里的事件，不会 throw
        case 'error':
          yield { type: 'error', message: describeError(part.error) }
          break

        default:
          // 其余事件（text-start / tool-input-delta / source / raw ...）我们不用，
          // 显式忽略。留着 default 是为了将来 SDK 加新事件时不至于静默出错。
          break
      }
    }
  } catch (error) {
    // 网络层/鉴权层炸了才走到这里（比如 key 不对、超时）
    yield { type: 'error', message: describeError(error) }
  }
}

export const deepseekProvider: LLMProvider = {
  id: 'deepseek',
  label: 'DeepSeek',
  models: MODELS,
  chat,
  runAgent,
}
