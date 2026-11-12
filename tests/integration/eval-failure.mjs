// 测「失败也记录」：被测模型跑挂了，这一条用例应该留下记录 + 错误原因，
// 而不是从结果里消失。消失的话，进度条会永远停在 N-1/N，而且你不知道为什么。
//
// 用不存在的模型名来触发真实失败 —— 不 mock，走的是和线上一样的代码路径。
//
// 用法（在仓库根目录跑）：
//   node tests/integration/eval-failure.mjs http://localhost:3000

const BASE = process.argv[2] ?? 'http://localhost:3000'
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE) && process.env.ALLOW_REMOTE !== '1') {
  console.error('拒绝在非本地地址跑：会真写库。确认要在远端跑，设 ALLOW_REMOTE=1。')
  process.exit(1)
}

const stamp = Date.now().toString(36)

const post = async (path, body = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`)
  return json
}

const { dataset } = await post('/api/datasets', {
  name: `失败路径-${stamp}`,
  cases: [{ input: '1+1 等于几？只回答数字。', reference: '2' }],
})

const detail = await (await fetch(`${BASE}/api/datasets/${dataset.id}`)).json()
const caseId = detail.dataset.cases[0].id

const { promptVersion } = await post('/api/prompts', {
  name: `坏模型-${stamp}`,
  system: '你是一个数学助手。',
  model: 'this-model-does-not-exist',
})

const { evalRun } = await post('/api/evals', {
  datasetId: dataset.id,
  promptVersionId: promptVersion.id,
})

const out = await post(`/api/evals/${evalRun.id}/cases/${caseId}`)
const r = out.result

console.log('结果：', {
  score: r.score,
  output: r.output,
  error: r.error?.slice(0, 80),
})

const checks = [
  ['失败也留下了结果行', Boolean(r.id)],
  ['score 是 null 而不是 0', r.score === null],
  ['没有编造输出', r.output === null],
  ['错误原因写进了记录', typeof r.error === 'string' && r.error.length > 0],
  ['评测被标记为完成（跑完了，只是跑挂了）', out.doneCount === 1],
]

let bad = 0
for (const [name, ok] of checks) {
  if (!ok) bad++
  console.log(`${ok ? '通过' : '失败'}  ${name}`)
}

console.log(`\n测试数据：promptVersionId=${promptVersion.id} evalRunId=${evalRun.id}`)
console.log(bad === 0 ? '断言全部通过' : `有 ${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
