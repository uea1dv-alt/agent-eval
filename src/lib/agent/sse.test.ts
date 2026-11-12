import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createSseDecoder, encodeSse } from './sse'

/**
 * SSE 解码器。
 *
 * 为什么要测「切块」：网络一次给多少字节是不确定的 ——
 * 一条消息可能被切成三段，三条消息也可能挤在一个 chunk 里。
 * 按 chunk 直接 JSON.parse 是最常见的写法，也是最常见的 bug，
 * 而且只在网络恰好抖一下的时候才现形。
 */

function decodeAll(chunks: string[]) {
  const push = createSseDecoder()
  return chunks.flatMap((chunk) => push(chunk))
}

function chunkBy(text: string, size: number): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size))
  return chunks
}

function chunkRandom(text: string, seed: number): string[] {
  let state = seed
  const random = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    const size = 1 + Math.floor(random() * 37)
    chunks.push(text.slice(i, i + size))
    i += size
  }
  return chunks
}

const PAYLOADS = [
  { event: 'span', data: JSON.stringify({ type: 'span', span: { id: 'a', text: '第一步' } }) },
  { event: 'span', data: JSON.stringify({ type: 'span', span: { id: 'b', text: '第二步' } }) },
  // 没有 event 字段的消息，解码出来是 event: undefined —— 期望值也要写全
  { event: undefined, data: JSON.stringify({ type: 'agent', text: '换行\n在正文里' }) },
]

const wire = PAYLOADS.map((p) => encodeSse(JSON.parse(p.data), p.event)).join('')

describe('SSE 编解码', () => {
  it('编码再解码，消息一条不少、内容不变', () => {
    assert.deepEqual(decodeAll([wire]), PAYLOADS)
  })

  it('无论网络怎么切块，结果都一样', () => {
    for (let size = 1; size <= wire.length; size++) {
      assert.deepEqual(
        decodeAll(chunkBy(wire, size)),
        PAYLOADS,
        `每 ${size} 字节一块时解析结果不一致`,
      )
    }
  })

  it('随机切块（多个种子）', () => {
    for (const seed of [1, 42, 20261112]) {
      assert.deepEqual(decodeAll(chunkRandom(wire, seed)), PAYLOADS, `seed=${seed}`)
    }
  })

  it('CRLF 换行也能解析', () => {
    assert.deepEqual(decodeAll([wire.replace(/\n/g, '\r\n')]), PAYLOADS)
  })

  it('末尾孤零零的 \\r 要先扣住，不能当换行 —— 否则事件边界会错位', () => {
    // 这一块以 \r 结尾，下一块以 \n 开头。如果这里就把 \r 当换行，
    // 下一块的 \n 会变成一个多余的空行，把消息切错。
    const pieces: string[] = []
    for (const chunk of chunkBy(wire.replace(/\n/g, '\r\n'), 5)) pieces.push(chunk)

    // 主动构造「\r 正好落在块尾」的情况
    const index = wire.indexOf('\n')
    const split = [wire.slice(0, index + 1).replace(/\n$/, '\r'), '\n' + wire.slice(index + 1)]

    assert.deepEqual(decodeAll(pieces), PAYLOADS)
    assert.deepEqual(decodeAll(split), PAYLOADS)
  })

  it('以冒号开头的心跳注释被忽略', () => {
    assert.deepEqual(decodeAll([`:\n\n${wire}`]), PAYLOADS)
  })

  it('没有 data 的块不产生消息', () => {
    assert.deepEqual(decodeAll(['event: ping\n\n']), [])
  })

  it('多行 data 用换行拼回去', () => {
    const [message] = decodeAll(['data: {"a":1,\ndata: "b":2}\n\n'])
    assert.equal(message.data, '{"a":1,\n"b":2}')
  })
})
