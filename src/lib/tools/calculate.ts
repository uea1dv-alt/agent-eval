import { z } from 'zod'
import type { AgentTool } from '@/lib/providers/types'

/**
 * 工具二：精确计算。
 *
 * 为什么需要它：**LLM 算数不可靠**。它是在「猜下一个 token」，不是在做算术 ——
 * 三位数加减法都可能出错，而且错得很自信。这不是模型笨，是它的工作原理决定的。
 *
 * 所以正确做法不是「让模型算准一点」，而是**别让它算**：模型负责决定「算什么」，
 * 精确执行交给工具。这是 agent 设计里最基本的一条分工。
 *
 * 实现上刻意**不用 eval**：eval 会把模型生成的字符串当代码执行，
 * 模型一旦被提示注入诱导，就等于把服务器交给它了。
 * 这里只认固定的几种运算，做不了别的。
 */

const inputSchema = z.object({
  operation: z
    .enum(['sum', 'average', 'median', 'min', 'max', 'count'])
    .describe('要做的运算：sum 求和 / average 平均 / median 中位数 / min 最小 / max 最大 / count 计数'),
  values: z
    .array(z.number())
    .min(1)
    .describe('参与运算的数字列表。通常是把 query_spans 结果里的 latencyMs 或 token 数抄过来'),
  decimals: z
    .number()
    .int()
    .min(0)
    .max(6)
    .optional()
    .describe('结果保留几位小数，默认 2'),
})

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export const calculateTool: AgentTool = {
  name: 'calculate',
  description:
    '对一串数字做精确运算（求和 / 平均 / 中位数 / 最大 / 最小 / 计数）。' +
    '**凡是涉及数字计算，一律用它，不要自己心算** —— 语言模型做算术不可靠，结果会很自信地错。',

  inputSchema,

  async execute(raw) {
    const args = inputSchema.parse(raw)
    const values = args.values
    const decimals = args.decimals ?? 2

    let result: number
    switch (args.operation) {
      case 'sum':
        result = values.reduce((a, b) => a + b, 0)
        break
      case 'average':
        result = values.reduce((a, b) => a + b, 0) / values.length
        break
      case 'median': {
        const sorted = [...values].sort((a, b) => a - b)
        const mid = Math.floor(sorted.length / 2)
        result =
          sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
        break
      }
      case 'min':
        result = Math.min(...values)
        break
      case 'max':
        result = Math.max(...values)
        break
      case 'count':
        result = values.length
        break
    }

    return {
      operation: args.operation,
      inputCount: values.length,
      // 计数结果本身就是整数，四舍五入反而怪
      result: args.operation === 'count' ? result : round(result, decimals),
    }
  },
}
