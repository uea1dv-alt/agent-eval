// 清理测试期间产生的地评测数据。
//
// 规矩：**先列出，确认后再真删**；按显式 id 一条条删，不用 deleteMany({})。
//
// 用法（在仓库根目录跑）：
//   node --env-file=.env tests/integration/cleanup-test-data.mjs              # 预览
//   CLEANUP_APPLY=1 node --env-file=.env tests/integration/cleanup-test-data.mjs   # 真删
//
// 用环境变量而不是命令行参数：`node -e "..." --apply` 会被 node 抢先当成自己的选项。
// Span 表一行都不碰 —— 那是主数据，测试造的那些运行记录留着无妨。
//
// 只删名字带这些前缀的（都是测试脚本自动加的时间戳后缀）：
const PREFIXES = ['算术自测-', '失败路径-', 'v1-简洁-', 'v2-要过程-', '坏模型-', 'v1-直接作答-', 'v2-要求过程-']

const apply = process.env.CLEANUP_APPLY === '1'

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()

const nameWhere = { OR: PREFIXES.map((p) => ({ name: { startsWith: p } })) }

const datasets = await prisma.dataset.findMany({
  where: nameWhere,
  include: { _count: { select: { cases: true, evals: true } } },
})
const prompts = await prisma.promptVersion.findMany({
  where: nameWhere,
  include: { _count: { select: { evals: true } } },
})

console.log('将要删除的数据集：')
for (const d of datasets) {
  console.log(`  ${d.id}  ${d.name}  （${d._count.cases} 用例 / ${d._count.evals} 评测）`)
}
console.log('将要删除的 prompt 版本：')
for (const p of prompts) {
  console.log(`  ${p.id}  ${p.name}  （${p._count.evals} 评测）`)
}

if (!apply) {
  console.log('\n这只是预览。确认无误后加 --apply 执行。')
  await prisma.$disconnect()
  process.exit(0)
}

// 删除顺序由外键决定：结果 → 评测 → 用例 → 数据集；评测 → 版本
//
// 同一个评测既可能落在「按数据集」的查询里，也可能落在「按版本」的查询里
// （我这批测试正好如此）。不先去重的话会第二次删同一个 id，撞 P2025 直接中断。
const evalIds = new Set()
for (const d of datasets) {
  const runs = await prisma.evalRun.findMany({ where: { datasetId: d.id }, select: { id: true } })
  for (const r of runs) evalIds.add(r.id)
}
for (const p of prompts) {
  const runs = await prisma.evalRun.findMany({ where: { promptVersionId: p.id }, select: { id: true } })
  for (const r of runs) evalIds.add(r.id)
}
for (const id of evalIds) {
  await prisma.evalRun.delete({ where: { id } }) // EvalResult 跟着级联删
}
const removedEvals = evalIds.size

for (const d of datasets) {
  const cases = await prisma.datasetCase.findMany({ where: { datasetId: d.id }, select: { id: true } })
  for (const c of cases) {
    await prisma.datasetCase.delete({ where: { id: c.id } })
  }
  await prisma.dataset.delete({ where: { id: d.id } })
}
for (const p of prompts) {
  await prisma.promptVersion.delete({ where: { id: p.id } })
}

console.log(
  `\n删掉了 ${datasets.length} 个数据集、${prompts.length} 个 prompt 版本、${removedEvals} 次评测。`,
)
await prisma.$disconnect()
