import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseJudgeOutput } from './parse-judge'

/**
 * judge 输出的容错解析。
 *
 * 为什么这块最值得测：解析失败不会报错，只会让分数变成 null ——
 * 如果退化成 0，两个 prompt 版本的对比就会凭空多出一段「差距」。
 * 下面这些形状都是真模型实际吐出来过的，不是我编的。
 */
describe('parseJudgeOutput', () => {
  const accepted: Array<[string, string, number]> = [
    ['干净的 JSON', '{"score": 8, "reason": "答案正确"}', 8],
    ['代码围栏 ```json', '```json\n{"score": 9, "reason": "完全正确"}\n```', 9],
    ['代码围栏 ``` 无语言', '```\n{"score": 6, "reason": "部分正确"}\n```', 6],
    ['前面多一句解释', '我的评分如下：\n{"score": 7, "reason": "基本正确"}', 7],
    [
      '前后都有解释',
      '好的，我评估完了。{"score": 5, "reason": "漏了关键步骤"}希望有帮助。',
      5,
    ],
    ['score 是字符串', '{"score": "8", "reason": "正确"}', 8],
    ['小数四舍五入', '{"score": 8.6, "reason": "很好"}', 9],
    ['超出上限被夹住', '{"score": 12, "reason": "太好了"}', 10],
    ['低于下限被夹住', '{"score": -3, "reason": "完全错"}', 0],
    ['理由里有大括号', '{"score": 7, "reason": "答案 {408} 正确"}', 7],
    ['理由前后有空格', '  {"score": 4, "reason": "   答案不完整  "}  ', 4],
  ]

  for (const [name, raw, expected] of accepted) {
    it(`能解析：${name}`, () => {
      assert.equal(parseJudgeOutput(raw).score, expected)
    })
  }

  const rejected: Array<[string, string]> = [
    ['完全不是 JSON', '我觉得挺好'],
    ['缺 reason', '{"score": 8}'],
    ['空字符串', ''],
    ['score 不是数字', '{"score": "很好", "reason": "x"}'],
    ['JSON 语法坏掉', '{"score": 8, "reason": }'],
  ]

  for (const [name, raw] of rejected) {
    it(`必须抛异常（调用方会记 null，不是 0）：${name}`, () => {
      assert.throws(() => parseJudgeOutput(raw))
    })
  }

  it('理由去掉首尾空白 —— 判分理由是人判断 judge 靠不靠谱的唯一依据', () => {
    assert.equal(parseJudgeOutput('{"score": 4, "reason": "   答案不完整  "}').reason, '答案不完整')
  })
})
