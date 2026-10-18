/**
 * Provider adapter 层的契约。
 *
 * 这一层解决的问题：把「用哪个模型厂商」这件事，从业务代码里赶出去。
 * 页面和 API 路由只认这里的接口，不认 DeepSeek。以后要加 OpenAI / 通义 / 智谱，
 * 只需要新写一个实现文件，别处一行不用改。
 */

import type { ZodType } from 'zod'

/**
 * span 类型。DB 里存的是 String，类型安全靠这个联合类型兜住。
 *
 * 为什么不在 DB 里用 enum：加一个类型就得跑一次迁移。Stage 1 加 `agent_run`
 * 时只改了这一行 —— 这就是当初选 String 的回报。
 */
export type SpanType = 'llm_call' | 'tool_call' | 'agent_run'

/** 思考强度。DeepSeek V4 支持 low / high / max。 */
export type ReasoningEffort = 'low' | 'high' | 'max'

/**
 * 模型能力声明。
 * 前端据此渲染表单，不用硬编码「哪个模型支持 thinking」——
 * 加新模型时只改 provider 实现，UI 自动跟上。
 */
export interface ModelInfo {
  id: string
  label: string
  /** 是否支持 thinking（思维链）模式 */
  supportsThinking: boolean
  /** 是否支持图片输入 */
  supportsVision: boolean
  /** 一句话说明，用于界面上给用户选型 */
  description?: string
}

/** 一次 LLM 调用的入参 */
export interface LLMCallParams {
  model: string
  prompt: string
  system?: string
  /**
   * 采样温度。
   * 注意：thinking 开启时该参数会被 DeepSeek 忽略（见各 provider 实现的注释）。
   */
  temperature?: number
  maxOutputTokens?: number
  thinking?: boolean
  reasoningEffort?: ReasoningEffort
}

/** token 用量。字段名对齐 AI SDK 7 —— 是 inputTokens/outputTokens，不是 promptTokens/completionTokens。 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** 思维链消耗的 token（含在 outputTokens 里）。只有开了 thinking 才有值。 */
  reasoningTokens?: number
}

/** 一次 LLM 调用的出参 */
export interface LLMCallResult {
  text: string
  /** 思维链正文。只有开了 thinking 才有值。 */
  reasoningText?: string
  finishReason: string
  usage: TokenUsage
  /** 端到端耗时（毫秒），由 provider 实现自己掐表 */
  latencyMs: number
}

/**
 * 一个可供模型调用的工具。
 *
 * 为什么 `execute` 的入参是 `unknown` 而不是从 schema 推断：
 * provider 层要能装下任意工具，写成泛型会让注册表变成一堆类型体操。
 * 参数校验交给 zod（schema 就在旁边），执行时再断言。
 */
export interface AgentTool {
  name: string
  description: string
  /** 入参的 zod schema —— 模型据此生成调用参数，SDK 据此校验 */
  inputSchema: ZodType
  /** 实际执行。返回值会被 JSON 序列化后交给模型 */
  execute: (input: unknown) => Promise<unknown>
}

/** 一次 agent 运行的入参 */
export interface AgentParams {
  model: string
  prompt: string
  system?: string
  /** 最多跑几步。防止模型在工具之间来回打转把额度烧光 */
  maxSteps: number
  temperature?: number
  maxOutputTokens?: number
  thinking?: boolean
  reasoningEffort?: ReasoningEffort
}

/**
 * agent 运行过程中往外抛的事件。
 *
 * provider 负责把各家 SDK 的流翻译成这个形状，**SDK 的类型不外泄** ——
 * 这正是 adapter 层的意义：换个厂商，上层一行不用改。
 *
 * 注意：这里**不含数据库操作**。provider 只负责「跑模型、调工具、报事件」，
 * 落库是 API 路由的事。
 */
export type AgentEvent =
  | { type: 'step_start'; step: number }
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  /**
   * `toolCallId` 是 SDK 给的配对号。
   * 为什么必须有它：模型**可以在一轮里同时调多个工具**，那样会有多个 tool_call
   * 和多个 tool_result 交错到达。只靠工具名或到达顺序配对，遇到同名工具就会串。
   */
  | { type: 'tool_call'; toolCallId: string; toolName: string; input: unknown }
  /** 工具执行完（或失败）。失败时 error 有值、output 为 null —— 失败也要被记录 */
  | {
      type: 'tool_result'
      toolCallId: string
      toolName: string
      output: unknown
      latencyMs: number
      error?: string
    }
  | {
      type: 'step_end'
      step: number
      text: string
      reasoningText?: string
      finishReason: string
      usage: TokenUsage
      latencyMs: number
    }
  | { type: 'done'; text: string; usage: TokenUsage; stepCount: number }
  | { type: 'error'; message: string }

/** 所有 provider 实现都必须满足的接口 */
export interface LLMProvider {
  /** 唯一标识，例如 'deepseek' */
  id: string
  /** 界面上显示的名字 */
  label: string
  /** 该 provider 下可用的模型及各自能力 */
  models: ModelInfo[]
  /** 单次调用。Stage 0 的路径，保留 */
  chat(params: LLMCallParams): Promise<LLMCallResult>
  /**
   * 多步 agent：跑模型 → 需要就调工具 → 把结果喂回去 → 再跑，直到模型给出最终答案。
   * 返回异步可迭代对象，事件边产生边抛。
   */
  runAgent(params: AgentParams, tools: AgentTool[]): AsyncIterable<AgentEvent>
}
