import type { Span } from '@prisma/client'

/**
 * Span 的序列化与 JSON 字段解析。
 *
 * 为什么需要这层：数据库里的 Span 有 Date 对象，直接传给客户端组件会有序列化问题；
 * 而且 input/output 存的是 JSON 字符串，读的时候要解析、解析失败还要兜住。
 * 把这些脏活收在一个文件里，页面组件就能拿到干净的数据。
 */

/** 落库到 span.input 的结构 */
export interface SpanInputPayload {
  prompt: string
  system?: string
  temperature?: number
  maxOutputTokens?: number
  thinking?: boolean
  reasoningEffort?: string
}

/** 落库到 span.output 的结构。失败的调用也会有记录 —— 失败本身就是评测要看的数据。 */
export interface SpanOutputPayload {
  text?: string
  reasoningText?: string
  finishReason?: string
  /** 调用失败时写这里 */
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
    input: safeParse<SpanInputPayload>(span.input) ?? { prompt: '' },
    output: safeParse<SpanOutputPayload>(span.output),
    model: span.model,
    inputTokens: span.inputTokens,
    outputTokens: span.outputTokens,
    latencyMs: span.latencyMs,
    createdAt: span.createdAt.toISOString(),
  }
}
