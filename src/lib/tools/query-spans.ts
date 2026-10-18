import { z } from 'zod'
import { prisma } from '@/lib/db'
import type { AgentTool } from '@/lib/providers/types'

/**
 * 工具一：查这个平台自己记录的历史调用。
 *
 * 为什么这个工具有意思：**评测平台被 agent 用来查自己的 trace**。
 * 数据不是造的，就是页面上看到的那些记录。
 *
 * 刻意只返回**原始行**，不做聚合。聚合交给 calculate 工具 ——
 * 这样「查库 → 算数」天然是两步，正好演示多步 agent。
 */

const inputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('取最近多少条，默认 5'),
  type: z
    .enum(['llm_call', 'tool_call', 'agent_run'])
    .optional()
    .describe('只看某一类 span，不传就是全部'),
  model: z.string().optional().describe('只看某个模型的调用，例如 deepseek-flash'),
})

/** 正文可能很长，喂给模型前先截断，省 token */
function preview(text: string | undefined, max = 200): string | undefined {
  if (!text) return undefined
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export const querySpansTool: AgentTool = {
  name: 'query_spans',
  description:
    '查询本平台记录的历史调用记录（trace），按时间倒序返回原始数据行，含 token 数、耗时、模型等。' +
    '回答「最近几次调用多快 / 用了多少 token / 哪个模型更贵」这类问题时用它取数。' +
    '注意：它只返回原始行，不做任何聚合计算 —— 要算平均、总和、最大最小值，请把数字交给 calculate 工具。',

  inputSchema,

  async execute(raw) {
    const args = inputSchema.parse(raw)

    const rows = await prisma.span.findMany({
      // Prisma 把 undefined 当作「这个条件不生效」，所以不用手动拼 where
      where: { type: args.type, model: args.model },
      orderBy: { createdAt: 'desc' },
      take: args.limit ?? 5,
      select: {
        id: true,
        runId: true,
        type: true,
        name: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        latencyMs: true,
        createdAt: true,
        output: true,
      },
    })

    return {
      count: rows.length,
      rows: rows.map((row) => ({
        id: row.id,
        runId: row.runId,
        type: row.type,
        name: row.name,
        model: row.model,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        latencyMs: row.latencyMs,
        createdAt: row.createdAt.toISOString(),
        outputPreview: preview(row.output ?? undefined),
      })),
    }
  },
}
