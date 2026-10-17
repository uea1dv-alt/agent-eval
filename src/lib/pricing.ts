/**
 * 价格表 —— 把 token 数换算成钱。
 *
 * 为什么评测平台要有这个：跑批量评测时最容易失控的就是成本。
 * 页面上直接显示「这次调用花了多少钱」，比看 token 数直观得多。
 *
 * 数据来源：https://api-docs.deepseek.com/quick_start/pricing （2026-10 抓取）
 * 单位：美元 / 100 万 token
 *
 * 两个简化（都是故意的高估，宁可估高不估低）：
 *   1. DeepSeek 有高峰/非高峰价，非高峰是高峰的一半。这里统一按**高峰价**算。
 *   2. 输入不区分是否命中缓存，统一按**未命中**价算（命中价便宜几十倍）。
 * 所以页面上显示的是「上限估计」，实际账单通常更低。
 */

interface ModelPrice {
  /** 输入，缓存未命中 */
  inputCacheMiss: number
  /** 输入，缓存命中 */
  inputCacheHit: number
  /** 输出 */
  output: number
}

const PRICES: Record<string, ModelPrice> = {
  'deepseek-flash': { inputCacheMiss: 0.3, inputCacheHit: 0.006, output: 1.2 },
  'deepseek-v4-pro': { inputCacheMiss: 1.32, inputCacheHit: 0.044, output: 3.96 },
}

/**
 * 估算一次调用的成本（美元）。
 * 模型不在价格表里时返回 null —— 调用方据此显示「—」而不是显示一个错的 0。
 */
export function estimateCostUsd(
  model: string | null | undefined,
  usage: { inputTokens: number | null; outputTokens: number | null },
): number | null {
  if (!model) return null
  const price = PRICES[model]
  if (!price) return null

  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0

  return (
    (inputTokens / 1_000_000) * price.inputCacheMiss +
    (outputTokens / 1_000_000) * price.output
  )
}

/**
 * 把美元金额格式化成人看的样子。
 *
 * 单次调用的花费通常在 1e-5 到 1e-4 美元这个量级，直接 toFixed(4) 会显示成 $0.0000
 * 看着像没花钱。所以按量级选择小数位，并且**一律不用科学计数法** ——
 * `$3.72e-5` 这种东西在表格里既难读又会折行。
 */
export function formatCostUsd(usd: number | null): string {
  if (usd === null) return '—'
  if (usd === 0) return '$0'
  if (usd < 0.000001) return '<$0.000001'
  if (usd < 0.01) return `$${usd.toFixed(6)}`
  if (usd < 1) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

export function formatTokens(n: number | null): string {
  if (n === null) return '—'
  return n.toLocaleString('en-US')
}
