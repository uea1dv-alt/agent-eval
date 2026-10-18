import type { AgentEvent } from '@/lib/providers/types'
import type { SerializedSpan } from '@/lib/spans'

/**
 * SSE 线路上真正传输的事件。
 *
 * 为什么要在 AgentEvent 外面再包一层，而不是直接推 AgentEvent：
 * 有两类完全不同的东西要推给客户端 ——
 *   1. **agent 的实时过程**（正在打字、正在调工具）→ 用来做「边跑边显示」
 *   2. **落库后的 span**（数据库里的权威数据）→ 用来做「树边跑边长」
 *
 * 它们不是一回事：一次 agent 事件可能触发一次写库（然后推一个 span），
 * 也可能不触发。混在一个联合类型里，客户端就得靠猜。
 *
 * 另外 `AgentEvent` 自己也有 `type` 字段，直接混进来会让 `switch (event.type)`
 * 同时命中两套语义完全不同的取值 —— 这是个很容易踩的坑，包一层就干净了。
 */
export type StreamEvent =
  /** 运行开始，根 span（agent_run）已经落库 */
  | { type: 'run_start'; runId: string; span: SerializedSpan }
  /** agent 过程事件，用于实时显示 */
  | { type: 'agent'; event: AgentEvent }
  /** 某个 span 落库或更新了，客户端拿去做 upsert 重建树 */
  | { type: 'span'; span: SerializedSpan }
  /** 运行结束 */
  | { type: 'run_end'; runId: string; latencyMs: number }
  /** 整条流水线出错 */
  | { type: 'error'; message: string }
