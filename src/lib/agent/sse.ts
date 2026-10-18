/**
 * SSE（Server-Sent Events）的编解码。
 *
 * 为什么用 SSE 而不是 WebSocket：这里是**单向**的 —— 服务端一直说，客户端一直听，
 * 不需要客户端往同一条连接里发东西（发请求是另开一个 POST）。SSE 就是为这个场景设计的，
 * 而且它走的是普通 HTTP，不需要额外协议升级，Vercel 的 serverless 函数天然支持。
 *
 * 为什么不用普通 JSON 响应：普通响应要等整个 agent 跑完才返回。
 * agent 跑三步可能要 20 秒，用户盯着白屏 20 秒，体验很差，而且看不出「卡在哪一步」。
 * SSE 让每一步、甚至每一个字都能立刻推出去。
 *
 * 线格式（SSE 规范）长这样 —— 事件之间用**空行**分隔：
 *
 *   event: span
 *   data: {"type":"span","span":{...}}
 *   <空行>
 */

export interface SseMessage {
  event?: string
  data: string
}

/** 服务端用：把一个对象编码成一条 SSE 消息 */
export function encodeSse(data: unknown, event?: string): string {
  const payload = JSON.stringify(data)
  // 规范要求 data 里不能有裸换行。JSON.stringify 本来就会把换行转义成 \n，
  // 但这里还是拆一次 —— 万一以后换成非 JSON 的 payload，不至于悄悄坏掉。
  const lines = payload
    .split('\n')
    .map((line) => `data: ${line}`)
    .join('\n')
  return `${event ? `event: ${event}\n` : ''}${lines}\n\n`
}

/**
 * 客户端用：喂进去一段一段的原始文本，吐出来已经解析好的完整消息。
 *
 * 为什么要有状态：网络一次给多少字节是**不确定的**。一条消息可能被拆成三个 chunk
 * 送过来，也可能三条消息挤在一个 chunk 里。所以必须自己缓冲、自己找边界。
 * 直接对每个 chunk 做 JSON.parse 是最常见的写法，也是最常见的 bug 来源。
 */
export function createSseDecoder() {
  let buffer = ''

  return function push(chunk: string): SseMessage[] {
    buffer += chunk

    // SSE 规范允许三种换行：CRLF、LF、单独的 CR。全部归一成 LF 再找边界。
    //
    // 这里有个很容易漏的坑：**末尾那个孤零零的 `\r` 先不能动**。
    // 它可能是下一块开头的 `\n` 的另一半 —— 现在就把它当换行处理掉，
    // 等 `\n` 到了就变成一个多出来的空行，事件边界整个错位。
    // 所以先把它扣下来，等下一块到了再一起判断。
    const held = buffer.endsWith('\r') ? '\r' : ''
    const head = held ? buffer.slice(0, -1) : buffer
    const normalized = head.replace(/\r\n?/g, '\n')

    const messages: SseMessage[] = []
    let start = 0
    let boundary = normalized.indexOf('\n\n')

    while (boundary !== -1) {
      const message = parseBlock(normalized.slice(start, boundary))
      if (message) messages.push(message)

      start = boundary + 2
      boundary = normalized.indexOf('\n\n', start)
    }

    // 没消费完的部分留着，跟扣下的 \r 一起等下一块
    buffer = normalized.slice(start) + held

    return messages
  }
}

function parseBlock(block: string): SseMessage | null {
  let event: string | undefined
  const dataLines: string[] = []

  for (const line of block.split('\n')) {
    // 以冒号开头的是注释（SSE 用它做心跳保活），直接跳过
    if (line.startsWith(':')) continue

    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''))
    }
    // 其余字段（id: / retry:）我们不用
  }

  if (dataLines.length === 0) return null
  return { event, data: dataLines.join('\n') }
}
