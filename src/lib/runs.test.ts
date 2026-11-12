import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groupByRun } from './runs'
import type { SerializedSpan } from './spans'

function span(init: Partial<SerializedSpan> & { id: string; runId: string }): SerializedSpan {
  return {
    parentId: null,
    type: 'llm_call',
    name: init.id,
    input: {},
    output: {},
    model: 'deepseek-flash',
    inputTokens: null,
    outputTokens: null,
    latencyMs: null,
    createdAt: '2026-03-10T00:00:00.000Z',
    ...init,
  }
}

describe('groupByRun', () => {
  it('同一次运行的 span 归成一组，并按时间正序', () => {
    const groups = groupByRun([
      span({ id: 'step-2', runId: 'r1', parentId: 'root', createdAt: '2026-03-10T00:00:02.000Z' }),
      span({
        id: 'root',
        runId: 'r1',
        type: 'agent_run',
        createdAt: '2026-03-10T00:00:00.000Z',
      }),
      span({ id: 'step-1', runId: 'r1', parentId: 'root', createdAt: '2026-03-10T00:00:01.000Z' }),
    ])

    assert.equal(groups.length, 1)
    assert.deepEqual(
      groups[0].spans.map((s) => s.id),
      ['root', 'step-1', 'step-2'],
    )
  })

  it('token 只累加 llm_call —— agent_run 上的汇总量不能再算一遍', () => {
    // 这是最容易犯的重复计数错误：两边都算，token 直接翻倍
    const [group] = groupByRun([
      span({
        id: 'root',
        runId: 'r1',
        type: 'agent_run',
        inputTokens: 100,
        outputTokens: 50,
      }),
      span({ id: 'step-1', runId: 'r1', parentId: 'root', inputTokens: 60, outputTokens: 30 }),
      span({ id: 'step-2', runId: 'r1', parentId: 'root', inputTokens: 40, outputTokens: 20 }),
    ])

    assert.equal(group.inputTokens, 100)
    assert.equal(group.outputTokens, 50)
  })

  it('根节点优先认 agent_run —— 脏数据里出现两个无父节点时也不能选错', () => {
    const [group] = groupByRun([
      span({ id: 'dirty', runId: 'r1', createdAt: '2026-03-10T00:00:01.000Z' }),
      span({
        id: 'root',
        runId: 'r1',
        type: 'agent_run',
        createdAt: '2026-03-10T00:00:00.000Z',
      }),
    ])

    assert.equal(group.root.id, 'root')
  })

  it('失败判定读 output.error，不靠字符串匹配', () => {
    const [group] = groupByRun([
      span({ id: 'root', runId: 'r1', type: 'agent_run' }),
      span({ id: 'step', runId: 'r1', parentId: 'root', output: { error: '模型超时' } }),
    ])

    assert.equal(group.failed, true)
    assert.equal(group.error, '模型超时')
  })

  it('模型回复里出现 error 这个词不算失败', () => {
    const [group] = groupByRun([
      span({ id: 'root', runId: 'r1', output: { text: '返回了一个 error，但调用是成功的' } }),
    ])

    assert.equal(group.failed, false)
  })

  it('运行按新到旧排', () => {
    const groups = groupByRun([
      span({ id: 'old', runId: 'old', createdAt: '2026-03-10T03:00:00.000Z' }),
      span({ id: 'new', runId: 'new', createdAt: '2026-03-10T05:00:00.000Z' }),
    ])

    assert.deepEqual(
      groups.map((g) => g.runId),
      ['new', 'old'],
    )
  })

  it('Stage 0 的单次调用：根就是那条 llm_call，也算 1 步', () => {
    const [group] = groupByRun([
      span({
        id: 'only',
        runId: 'r1',
        input: { prompt: '你好' },
        latencyMs: 1200,
      }),
    ])

    assert.equal(group.root.id, 'only')
    assert.equal(group.prompt, '你好')
    assert.equal(group.stepCount, 1)
    assert.equal(group.toolCount, 0)
    assert.equal(group.latencyMs, 1200)
  })
})
