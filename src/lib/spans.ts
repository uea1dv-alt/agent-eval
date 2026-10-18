import type { Span } from '@prisma/client'

/**
 * Span 的序列化与 JSON 字段解析。
 *
 * 为什么需要这层：数据库里的 Span 有 Date 对象，直接传给客户端组件会有序列化问题；
 * 而且 input/output 存的是 JSON 字符串，读的时候要解析、解析失败还要兜住。
 * 把这些脏活收在一个文件里，页面组件就能拿到干净的数据。
 */

/**
 * 落库到 span.input 的结构。
 *
 * 为什么不按 type 拆成三个接口再取联合类型：界面上的树是**通用渲染** ——
 * 一个组件要能画任意类型的节点。用联合类型的话，每访问一个字段都要先收窄，
 * 递归组件里会写满类型体操。所以这里用一个「所有字段都可选」的超集，
 * 字段归属靠下面的分组注释说清。代价是类型检查松一点，换来的是一处定义处处能用。
 *
 * 注意：`type` 那一列是 String 不是 enum，所以**字段和 type 的对应关系靠约定**，
 * 数据库不会帮你兜。写的时候按注释来。
 */
export interface SpanInputPayload {
  // ---- llm_call / agent_run ----
  prompt?: string
  system?: string
  temperature?: number
  maxOutputTokens?: number
  thinking?: boolean
  reasoningEffort?: string

  // ---- agent_run ----
  model?: string
  maxSteps?: number

  // ---- llm_call ----
  /** 第几步（从 1 开始）。一次 agent 运行的第 N 次模型调用 */
  step?: number

  // ---- tool_call ----
  toolName?: string
  args?: unknown
}

/**
 * 落库到 span.output 的结构。
 *
 * 失败的调用也会有记录 —— 失败本身就是评测要看的数据，这是 Stage 0 就定下的原则。
 */
export interface SpanOutputPayload {
  // ---- llm_call / agent_run ----
  text?: string
  reasoningText?: string
  finishReason?: string

  // ---- agent_run ----
  /** 这次运行一共跑了几步 */
  stepCount?: number

  // ---- tool_call ----
  result?: unknown

  // ---- 任何类型：失败时写这里 ----
  error?: string
}

/** 传给客户端组件的形状：Date 转成 ISO 字符串，JSON 字符串解析成对象 */
export interface SerializedSpan {
  id: string
  runId: string
  parentId: string | null
  type: string
  name: string
  input: SpanInputPayload
  output: SpanOutputPayload | null
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: number | null
  createdAt: string
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    // 数据库里存了非法 JSON（比如手工改过）也不能让页面崩
    return null
  }
}

export function serializeSpan(span: Span): SerializedSpan {
  return {
    id: span.id,
    runId: span.runId,
    parentId: span.parentId,
    type: span.type,
    name: span.name,
    // 解析失败时给空对象而不是 { prompt: '' }：tool_call 的 input 本来就没有 prompt
    input: safeParse<SpanInputPayload>(span.input) ?? {},
    output: safeParse<SpanOutputPayload>(span.output),
    model: span.model,
    inputTokens: span.inputTokens,
    outputTokens: span.outputTokens,
    latencyMs: span.latencyMs,
    createdAt: span.createdAt.toISOString(),
  }
}
