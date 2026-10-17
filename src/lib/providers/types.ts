/**
 * Provider adapter 层的契约。
 *
 * 这一层解决的问题：把「用哪个模型厂商」这件事，从业务代码里赶出去。
 * 页面和 API 路由只认这里的接口，不认 DeepSeek。以后要加 OpenAI / 通义 / 智谱，
 * 只需要新写一个实现文件，别处一行不用改。
 */

/** span 类型。DB 里是 String（SQLite 不支持 enum），类型安全靠这个联合类型兜住。 */
export type SpanType = 'llm_call' | 'tool_call'

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

/** 所有 provider 实现都必须满足的接口 */
export interface LLMProvider {
  /** 唯一标识，例如 'deepseek' */
  id: string
  /** 界面上显示的名字 */
  label: string
  /** 该 provider 下可用的模型及各自能力 */
  models: ModelInfo[]
  chat(params: LLMCallParams): Promise<LLMCallResult>
}
