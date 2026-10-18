/**
 * 把任意 catch 到的东西转成一句人能读的话。
 *
 * 为什么需要它：TS 里 `catch (e)` 的 `e` 类型是 `unknown` —— 这是对的，
 * 因为 JS 允许 `throw '字符串'`、`throw { code: 1 }`，抛什么都有可能。
 * 但直接 `e.message` 编译不过，很多人就顺手写 `(e as Error).message`，
 * 那样抛字符串时 message 是 undefined，错误信息就凭空消失了。
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    // 循环引用的对象 stringify 会抛，兜住
    return String(error)
  }
}
