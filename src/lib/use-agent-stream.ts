'use client'

import { useCallback, useRef, useState } from 'react'
import { createSseDecoder } from '@/lib/agent/sse'
import type { StreamEvent } from '@/lib/agent/events'
import type { SerializedSpan } from '@/lib/spans'

/**
 * 消费 `/api/runs/stream` 的 SSE 流，边收边更新界面。
 *
 * 为什么单独抽成一个 hook：这里面全是「读流 → 解析 → 合并状态」的脏活，
 * 跟表单长相、跟树怎么画都没关系。抽出来之后，组件只管「长什么样」。
 *
 * 为什么不用浏览器内置的 `EventSource`：`EventSource` 只能发 GET，
 * 没法带请求体。我们的 prompt 可能很长，塞进 query string 既难看又有长度限制，
 * 所以用 `fetch` + 手写解析（解析器在 `lib/agent/sse.ts`）。
 */

export interface AgentRunRequest {
  providerId: string
  model: string
  prompt: string
  system?: string
  maxSteps: number
  temperature?: number
  maxOutputTokens?: number
  thinking: boolean
  reasoningEffort?: string
}

export interface AgentStreamState {
  status: 'idle' | 'running' | 'done' | 'error'
  runId: string | null
  /** 已经落库的 span。每收到一条就 upsert 一次 —— 树就是这么「边长」的 */
  spans: SerializedSpan[]
  /** 当前步正在生成的正文（打字机效果） */
  streamText: string
  streamReasoning: string
  /** 当前第几步 */
  step: number
  /** 正在执行中的工具名 */
  activeTools: string[]
  /** 整次运行的墙钟耗时 */
  latencyMs: number | null
  /** 致命错误：整次运行失败了 */
  error: string | null
  /** 非致命告警：比如某条 span 没写进数据库，但模型调用本身是好的 */
  warnings: string[]
}

const INITIAL: AgentStreamState = {
  status: 'idle',
  runId: null,
  spans: [],
  streamText: '',
  streamReasoning: '',
  step: 0,
  activeTools: [],
  latencyMs: null,
  error: null,
  warnings: [],
}

export function useAgentStream() {
  const [state, setState] = useState<AgentStreamState>(INITIAL)
  const abortRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setState((s) => (s.status === 'running' ? { ...s, status: 'idle' } : s))
  }, [])

  const run = useCallback(async (body: AgentRunRequest) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // 流里的事件是**增量**的，必须自己攒。用一个可变对象 + 手动 flush，
    // 而不是每来一个事件就 setState 一次 —— 一次运行有上百个 text_delta，
    // 每个都触发一次渲染会把界面卡住。
    const live: AgentStreamState = { ...INITIAL, status: 'running', activeTools: [] }
    const spanMap = new Map<string, SerializedSpan>()

    const flush = () => setState({ ...live, spans: [...spanMap.values()] })

    const handle = (event: StreamEvent) => {
      switch (event.type) {
        case 'run_start':
          live.runId = event.runId
          spanMap.set(event.span.id, event.span)
          flush()
          break

        // 落库后的权威数据。同一个 id 会出现两次（先 INSERT 再 UPDATE），
        // 所以这里是 upsert 不是 append —— 否则树里会出现重复节点
        case 'span':
          spanMap.set(event.span.id, event.span)
          flush()
          break

        case 'agent': {
          const inner = event.event
          switch (inner.type) {
            case 'step_start':
              live.step = inner.step
              live.streamText = ''
              live.streamReasoning = ''
              break
            case 'text_delta':
              live.streamText += inner.text
              break
            case 'reasoning_delta':
              live.streamReasoning += inner.text
              break
            case 'tool_call':
              live.activeTools = [...live.activeTools, inner.toolName]
              break
            case 'tool_result':
              live.activeTools = live.activeTools.filter((n) => n !== inner.toolName)
              break
            case 'error':
              live.warnings = [...live.warnings, inner.message]
              break
          }
          flush()
          break
        }

        case 'run_end':
          live.status = 'done'
          live.latencyMs = event.latencyMs
          live.activeTools = []
          flush()
          break

        // 顶层 error 不一定是致命的：可能是「模型跑完了，但某条记录没写进库」。
        // 所以记成告警，不改 status —— 真有致命错误时流会自己结束。
        case 'error':
          live.warnings = [...live.warnings, event.message]
          flush()
          break
      }
    }

    try {
      const res = await fetch('/api/runs/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      // 流开始之前就失败了（参数不合法、未知 provider）—— 这时后端还能回正常的 JSON 错误
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        live.status = 'error'
        live.error = data?.error ?? `请求失败（HTTP ${res.status}）`
        flush()
        return
      }

      if (!res.body) {
        live.status = 'error'
        live.error = '服务器没有返回流式响应体'
        flush()
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      const parse = createSseDecoder()

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break

          // stream: true —— 一个多字节字符（比如中文）可能被切在两个 chunk 中间，
          // 不加这个参数会在边界上解出乱码
          for (const message of parse(decoder.decode(value, { stream: true }))) {
            let event: StreamEvent
            try {
              event = JSON.parse(message.data) as StreamEvent
            } catch {
              continue
            }
            handle(event)
          }
        }
      } finally {
        reader.releaseLock()
      }

      // 流正常结束但没收到 run_end（比如服务端被掐断）也要收尾，
      // 否则按钮会一直停在「运行中」
      if (live.status === 'running') {
        live.status = 'done'
        flush()
      }
    } catch (err) {
      // 用户主动取消不算错误
      if (err instanceof DOMException && err.name === 'AbortError') return
      live.status = 'error'
      live.error = err instanceof Error ? err.message : String(err)
      flush()
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [])

  return { state, run, cancel }
}
