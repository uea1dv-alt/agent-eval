import { buildTree, type TreeNode } from './agent/tree'
import type { SerializedSpan } from './spans'

/**
 * 把平铺的 span 列表整理成「一次运行」。
 *
 * 为什么需要这一层：Stage 0 时「一条 span = 一次调用」，列表直接列 span 就行。
 * Stage 1 之后「一次运行 = 一棵 span 树」，页面上该列的是**运行**，不是 span ——
 * 否则一次三步的 agent 会在列表里散成 8 行，看不出它们是一回事。
 *
 * runId 就是为此存在的：它把同一次运行的所有 span 绑在一起。
 * （Stage 0 每次运行只有一个 span，所以那时它看着有点多余 —— 现在派上用场了。）
 */
export interface RunGroup {
  runId: string
  /** 根 span。正常情况是 agent_run；Stage 0 的老记录是那条单独的 llm_call */
  root: SerializedSpan
  /** 这次运行的全部 span，按时间正序 */
  spans: SerializedSpan[]
  tree: TreeNode<SerializedSpan>[]
  model: string | null
  prompt: string
  /** 跑了几步（llm_call 的个数） */
  stepCount: number
  toolCount: number
  inputTokens: number
  outputTokens: number
  latencyMs: number | null
  failed: boolean
  error?: string
  createdAt: string
}

export function groupByRun(spans: SerializedSpan[]): RunGroup[] {
  const buckets = new Map<string, SerializedSpan[]>()
  for (const span of spans) {
    const bucket = buckets.get(span.runId)
    if (bucket) bucket.push(span)
    else buckets.set(span.runId, [span])
  }

  const groups: RunGroup[] = []

  for (const [runId, bucket] of buckets) {
    const sorted = [...bucket].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )

    // 根节点 = parentId 为 null 的那个。优先认 agent_run ——
    // 万一数据里混进了多个无父节点（历史脏数据），选 agent_run 更能代表整次运行。
    const root =
      sorted.find((s) => s.parentId === null && s.type === 'agent_run') ??
      sorted.find((s) => s.parentId === null) ??
      sorted[0]

    // token 只累加 llm_call。agent_run 上那份是**同一批数字的汇总**，
    // 两边都算就把 token 数翻倍了 —— 这是最容易犯的重复计数错误。
    const llmCalls = sorted.filter((s) => s.type === 'llm_call')
    const toolCalls = sorted.filter((s) => s.type === 'tool_call')

    const inputTokens = llmCalls.reduce((sum, s) => sum + (s.inputTokens ?? 0), 0)
    const outputTokens = llmCalls.reduce((sum, s) => sum + (s.outputTokens ?? 0), 0)

    const error = root.output?.error ?? llmCalls.find((s) => s.output?.error)?.output?.error

    groups.push({
      runId,
      root,
      spans: sorted,
      tree: buildTree(sorted),
      model: root.model,
      prompt: root.input.prompt ?? '',
      stepCount: llmCalls.length,
      toolCount: toolCalls.length,
      inputTokens,
      outputTokens,
      latencyMs: root.latencyMs,
      failed: Boolean(error),
      error,
      createdAt: root.createdAt,
    })
  }

  // 新的在前
  groups.sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.runId.localeCompare(a.runId),
  )

  return groups
}

/** span 类型的显示名。放这里而不是组件里 —— 列表和树都要用，得是同一套说法。 */
export const SPAN_TYPE_LABEL: Record<string, string> = {
  agent_run: '运行',
  llm_call: '模型调用',
  tool_call: '工具',
}
