import type { AgentTool } from '@/lib/providers/types'
import { calculateTool } from './calculate'
import { querySpansTool } from './query-spans'

/**
 * 工具注册表。
 *
 * 加新工具的流程：新写一个文件导出 AgentTool，在这里加进数组。
 * 和 provider 注册表一个思路 —— 上层只认这个数组，不认具体某个工具。
 *
 * 工具集刻意只留两个：**一个取数、一个算数**。
 * 这两个凑在一起天然是多步（先查再算），而且都是 agent 真的用得上的能力 ——
 * 不是为了让 demo 好看而硬塞的工具。
 */
export const agentTools: AgentTool[] = [querySpansTool, calculateTool]

/** 按名字找工具。找不到返回 undefined（SDK 自己会处理「模型调了不存在的工具」） */
export function findTool(name: string): AgentTool | undefined {
  return agentTools.find((t) => t.name === name)
}

export { calculateTool, querySpansTool }
