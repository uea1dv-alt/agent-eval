import { prisma } from './db'
import { groupByRun, type RunGroup } from './runs'
import { serializeSpan } from './spans'

/** 一页显示多少次运行。按「运行」分页，不是按「span」截断。 */
export const RUNS_PER_PAGE = 20

export interface RunPage {
  runs: RunGroup[]
  page: number
  hasPrev: boolean
  hasNext: boolean
}

/**
 * 分页读取历史运行。
 *
 * 为什么不能用 `span.findMany({ take: 300 })` 再分组：
 *   1. **分页边界会切开一次运行。** 一次 agent 运行有 6–9 个 span，300 条的窗口
 *      很容易落在某次运行中间 —— 子 span 的父节点没查进来，树就散了。
 *   2. 300 是个魔数：某次运行 span 特别多时，窗口里能装下的运行数会缩水，
 *      而页面上看不出少了谁。
 *
 * 两步走：
 *   第一步只用 groupBy 拿 runId（和每个 runId 最后一个 span 的时间），
 *   分页在这里发生 —— 数据库保证同一个 runId 的 span 绑在一起；
 *   第二步按 runId 把这 N 次运行的 span **全部**取回来。
 *
 * 两次查询各自走索引（`@@index([runId])` / `@@index([createdAt])`），
 * 代价是两次往返，换来的是任何一页里的树都是完整的。
 *
 * 分页用 offset（skip）而不是游标：运行之间的时间可能撞在同一毫秒，
 * 游标按「小于某时间」翻页会漏掉同时间的那次运行。页码简单、也不会漏。
 */
export async function listRunPage(page: number): Promise<RunPage> {
  const safePage = Math.max(1, Math.trunc(page) || 1)
  const skip = (safePage - 1) * RUNS_PER_PAGE

  // 多取一条，用来判断还有没有下一页 —— 比再查一次 count 便宜
  const grouped = await prisma.span.groupBy({
    by: ['runId'],
    _max: { createdAt: true },
    orderBy: [{ _max: { createdAt: 'desc' } }, { runId: 'asc' }],
    skip,
    take: RUNS_PER_PAGE + 1,
  })

  const hasNext = grouped.length > RUNS_PER_PAGE
  const runIds = grouped.slice(0, RUNS_PER_PAGE).map((g) => g.runId)

  if (runIds.length === 0) {
    return { runs: [], page: safePage, hasPrev: safePage > 1, hasNext: false }
  }

  // 这里刻意不设 take：一次运行的 span 必须全部拿到，否则树还是散的
  const spans = await prisma.span.findMany({
    where: { runId: { in: runIds } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  return {
    runs: groupByRun(spans.map(serializeSpan)),
    page: safePage,
    hasPrev: safePage > 1,
    hasNext,
  }
}
