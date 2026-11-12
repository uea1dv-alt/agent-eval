// 专测「一轮调多个工具」时的耗时准确性。
//
// 为什么单独测这个：写库挡住读流的 bug **只在工具并行时现形** ——
// 串行时每步只有一个工具，下一个流事件本来就要等，看不出漂移。
// 并行时两个 tool-call 挨着来，我们却卡在写库上，第二个工具的
// 「开始时刻」被记晚了几百毫秒，耗时就算歪了（实测报过 1560ms）。
//
// 用法（在仓库根目录跑）：
//   npx tsx tests/integration/parallel-tools.mjs http://localhost:3000
//
// 用 tsx 而不是 node：这个脚本直接 import 了 src 里的 .ts 文件（复用真正的 SSE 解码器），
// tsx 认 tsconfig 的路径别名，也不会刷 Node 的「模块类型未声明」警告。
import { createSseDecoder } from '../../src/lib/agent/sse.ts'

const BASE = process.argv[2] ?? 'http://localhost:3000'
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE) && process.env.ALLOW_REMOTE !== '1') {
  console.error('拒绝在非本地地址跑：会真调模型、真写库。确认要在远端跑，设 ALLOW_REMOTE=1。')
  process.exit(1)
}

// 故意要两个独立的计算 —— 模型倾向于在同一轮里并行调两次 calculate
const body = {
  model: 'deepseek-flash',
  prompt:
    '最近 6 次调用里，凡是记了输入 token 的，帮我算两个数：平均值，还有最大值。两个都要，分开算，别合并。',
  maxSteps: 6,
}

const res = await fetch(`${BASE}/api/runs/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
if (!res.ok) {
  console.log('失败：', res.status, await res.text())
  process.exit(1)
}

const reader = res.body.getReader()
const decoder = new TextDecoder()
const parse = createSseDecoder()

const spans = new Map()
for (;;) {
  const { done, value } = await reader.read()
  if (done) break
  for (const msg of parse(decoder.decode(value, { stream: true }))) {
    const ev = JSON.parse(msg.data)
    if (ev.type === 'run_start' || ev.type === 'span') spans.set(ev.span.id, ev.span)
  }
}
reader.releaseLock()

const all = [...spans.values()]
const llmCalls = all.filter((s) => s.type === 'llm_call')
const toolCalls = all.filter((s) => s.type === 'tool_call')

console.log(`共 ${all.length} 个 span：${llmCalls.length} 步，${toolCalls.length} 次工具调用\n`)

// 按父节点分组，看有没有哪一步底下挂了多个工具
const byParent = new Map()
for (const t of toolCalls) {
  if (!byParent.has(t.parentId)) byParent.set(t.parentId, [])
  byParent.get(t.parentId).push(t)
}

let parallelSteps = 0
for (const [parentId, tools] of byParent) {
  const step = llmCalls.find((c) => c.id === parentId)
  const tag = tools.length > 1 ? '★ 并行' : '  串行'
  if (tools.length > 1) parallelSteps++
  console.log(`${tag}  ${step?.name ?? parentId.slice(0, 8)}  底下 ${tools.length} 个工具`)
  for (const t of tools) {
    console.log(`         ${String(t.name).padEnd(12)} ${String(t.latencyMs).padStart(5)}ms`)
  }
}

console.log('\n=== 断言 ===')
const checks = [
  ['至少调了 2 次工具', toolCalls.length >= 2],
  ['所有工具耗时都是有限数字', toolCalls.every((t) => Number.isFinite(t.latencyMs))],
  [
    '没有工具耗时超过 3 秒（纯算术+本地查询不该那么慢）',
    toolCalls.every((t) => (t.latencyMs ?? 0) < 3000),
  ],
  ['每个工具都有结果或错误', toolCalls.every((t) => t.output && ('result' in t.output || 'error' in t.output))],
]

let bad = 0
for (const [name, ok] of checks) {
  if (!ok) bad++
  console.log(`${ok ? '通过' : '失败'}  ${name}`)
}

if (parallelSteps === 0) {
  console.log('\n注意：这次模型没在同一轮里并行调工具，没覆盖到并行场景。')
  console.log('耗时数字仍然可信（因为测量点已经挪进 execute 了），但没实测到并行。')
} else {
  console.log(`\n覆盖到 ${parallelSteps} 个并行步骤。`)
}
console.log(bad === 0 ? '断言全部通过' : `有 ${bad} 项失败`)
