// Stage 2 端到端测试：数据集 → 两个 prompt 版本 → 逐条评测 → 对比。
//
// 为什么用「算术题」当数据集：有唯一正确答案，judge 判得准，
// 出问题时能一眼看出是链路坏了还是模型答错了。
// 三题的难度按「直接答得出来 / 要进位 / 要勾股定理」铺开，
// 目的是让两个 prompt 版本有机会拉开分数差。
//
// 用法（在仓库根目录跑）：
//   node tests/integration/eval-pipeline.mjs http://localhost:3000
//
// 它会真调模型、真写数据库、真花钱 —— 所以不在 `npm test` 里，默认也只允许本地地址。

const BASE = process.argv[2] ?? 'http://localhost:3000'
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE) && process.env.ALLOW_REMOTE !== '1') {
  console.error('拒绝在非本地地址跑：会真花钱、真写库。确认要在远端跑，设 ALLOW_REMOTE=1。')
  process.exit(1)
}
const stamp = Date.now().toString(36)

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, init)
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`${path} 返回的不是 JSON（${res.status}）：${text.slice(0, 300)}`)
  }
  if (!res.ok) throw new Error(`${path} 失败 ${res.status}：${JSON.stringify(json)}`)
  return json
}

const post = (path, body) =>
  api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const CASES = [
  { input: '17 乘以 24 等于多少？只回答数字。', reference: '408' },
  { input: '把 3.7 和 8.35 相加，结果保留两位小数。', reference: '12.05' },
  {
    input: '一个直角三角形的两条直角边分别是 6 和 8，斜边是多长？只回答数字。',
    reference: '10',
  },
]

console.log('=== 1. 建数据集 ===')
const { dataset } = await post('/api/datasets', {
  name: `算术自测-${stamp}`,
  description: 'Stage 2 端到端测试用',
  cases: CASES,
})
console.log(`数据集「${dataset.name}」，${dataset.caseCount} 条用例`)

const detail = await api(`/api/datasets/${dataset.id}`)
const caseIds = detail.dataset.cases.map((c) => c.id)
console.log(`取到 ${caseIds.length} 个 caseId`)

console.log('\n=== 2. 建两个 prompt 版本 ===')
const v1 = (
  await post('/api/prompts', {
    name: `v1-简洁-${stamp}`,
    system: '你是一个数学助手。直接给出最终答案，不要写过程。',
    model: 'deepseek-flash',
    temperature: 0,
    maxOutputTokens: 200,
  })
).promptVersion
const v2 = (
  await post('/api/prompts', {
    name: `v2-要过程-${stamp}`,
    system: '你是一个数学助手。先简要写出计算过程，最后单独一行用「答案是：X」给出结果。',
    model: 'deepseek-flash',
    temperature: 0,
    maxOutputTokens: 400,
  })
).promptVersion
console.log(`v1 = ${v1.name}`)
console.log(`v2 = ${v2.name}`)

console.log('\n=== 3. 发起两次评测 ===')
const e1 = (await post('/api/evals', { datasetId: dataset.id, promptVersionId: v1.id })).evalRun
const e2 = (await post('/api/evals', { datasetId: dataset.id, promptVersionId: v2.id })).evalRun
console.log(`评测 1  judge=${e1.judgeModel}`)
console.log(`评测 2  judge=${e2.judgeModel}`)

async function runAll(evalId, label) {
  console.log(`\n=== 4. 跑完评测 ${label}（${caseIds.length} 条）===`)
  const results = []
  for (const [i, caseId] of caseIds.entries()) {
    const startedAt = Date.now()
    const out = await post(`/api/evals/${evalId}/cases/${caseId}`, {})
    const r = out.result
    results.push(r)
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.log(
      `  ${i + 1}/${caseIds.length}  ${secs}s  score=${r.score ?? '—'}  ` +
        `${String(r.error ?? '').slice(0, 60)}`,
    )
    if (r.output) console.log(`        回答：${r.output.replace(/\s+/g, ' ').slice(0, 70)}`)
  }
  return results
}

const r1 = await runAll(e1.id, 'v1')
const r2 = await runAll(e2.id, 'v2')

console.log('\n=== 5. 幂等检查（重跑已完成的用例不该再花钱）===')
const again = await post(`/api/evals/${e1.id}/cases/${caseIds[0]}`, {})
console.log(`cached = ${again.cached}  （必须是 true）`)

console.log('\n=== 6. 对比 ===')
const avg = (rs) => {
  const scored = rs.filter((r) => r.score !== null)
  if (scored.length === 0) return null
  return scored.reduce((a, r) => a + r.score, 0) / scored.length
}
console.log(`v1 平均分 ${avg(r1)?.toFixed(2) ?? '—'}   错误 ${r1.filter((r) => r.error).length} 条`)
console.log(`v2 平均分 ${avg(r2)?.toFixed(2) ?? '—'}   错误 ${r2.filter((r) => r.error).length} 条`)

console.log('\n=== 断言 ===')
const all = [...r1, ...r2]
const checks = [
  ['每条都有结果行', all.length === caseIds.length * 2],
  ['每条都被判了分（score 是 0-10 的整数）', all.every((r) => Number.isInteger(r.score) && r.score >= 0 && r.score <= 10)],
  ['每条都有判分理由', all.every((r) => typeof r.scoreReason === 'string' && r.scoreReason.length > 0)],
  ['judge token 单独记了账', all.every((r) => r.judgeInputTokens > 0 && r.judgeOutputTokens > 0)],
  ['被测 token 单独记了账', all.every((r) => r.inputTokens > 0 && r.outputTokens > 0)],
  ['没有用例带着 error', all.every((r) => !r.error)],
  ['重跑返回 cached', again.cached === true],
]
let bad = 0
for (const [name, ok] of checks) {
  if (!ok) bad++
  console.log(`${ok ? '通过' : '失败'}  ${name}`)
}

const { evals } = await api('/api/evals')
const mine = evals.filter((e) => e.id === e1.id || e.id === e2.id)
for (const e of mine) {
  const ok = e.status === 'done' && e.doneCount === e.caseCount
  if (!ok) bad++
  console.log(`${ok ? '通过' : '失败'}  评测 ${e.id.slice(0, 8)} 状态 ${e.status}（${e.doneCount}/${e.caseCount}）`)
}

console.log(bad === 0 ? '\n断言全部通过' : `\n有 ${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
