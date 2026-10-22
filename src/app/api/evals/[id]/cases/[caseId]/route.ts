import type { EvalResult } from '@prisma/client'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { describeError } from '@/lib/errors'
import { judgeAnswer } from '@/lib/eval/judge'
import { DEFAULT_PROVIDER_ID, getProvider } from '@/lib/providers'

/**
 * 跑一条用例需要两次模型调用 + 一次 judge，通常是 3～10 秒。
 * 不写 maxDuration 的话默认 10 秒就可能被掐断。
 */
export const maxDuration = 60

/** 评测结果没有 schema 里的 JSON 列，直接原样返回即可，这里只是统一日期格式 */
function serializeResult(r: EvalResult) {
  return { ...r, createdAt: r.createdAt.toISOString() }
}

/**
 * 跑一条用例：被测模型回答 → judge 打分 → 落库。
 *
 * **为什么一条用例一个请求**：
 *   1. Vercel 函数上限 60 秒。30 条用例 × 2 次调用，塞进一个请求必定超时，
 *      超时后既不知道跑到哪，也拿不到已经花了钱的那些结果
 *   2. 逐条跑，中途关页面/断网最多损失当前这一条，重试时已完成的会直接复用
 *
 * **幂等**：同一个 (评测, 用例) 只会有一条结果。重复请求直接返回已有的那条，
 * **不会重复花钱**。靠 `@@unique([evalRunId, caseId])` 兜底 ——
 * 前端并发点击时两个请求可能同时通过检查，唯一的兜底是数据库约束。
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; caseId: string }> },
) {
  // Next 16 的 route params 是 Promise，必须 await
  const { id, caseId } = await params

  try {
    const evalRun = await prisma.evalRun.findUnique({
      where: { id },
      include: { promptVersion: true },
    })
    if (!evalRun) return NextResponse.json({ error: '评测不存在' }, { status: 404 })

    const testCase = await prisma.datasetCase.findUnique({ where: { id: caseId } })
    if (!testCase) return NextResponse.json({ error: '用例不存在' }, { status: 404 })

    // 用例必须属于这次评测用的那个数据集。
    // 不查这一条的话，随便换个 caseId 就能把别的数据集的题混进这次评测里
    if (testCase.datasetId !== evalRun.datasetId) {
      return NextResponse.json({ error: '这条用例不属于本次评测的数据集' }, { status: 400 })
    }

    // 幂等：已经有结果就直接返回，不再调模型
    const existing = await prisma.evalResult.findUnique({
      where: { evalRunId_caseId: { evalRunId: id, caseId } },
    })
    if (existing) {
      return NextResponse.json({ result: serializeResult(existing), cached: true })
    }

    const provider = getProvider(DEFAULT_PROVIDER_ID)
    const pv = evalRun.promptVersion

    // ---- 1. 被测模型作答 ----
    let output: string | null = null
    let inputTokens: number | null = null
    let outputTokens: number | null = null
    let latencyMs: number | null = null
    let error: string | null = null

    try {
      const answer = await provider.chat({
        model: pv.model,
        // 这里比的**只有 system 提示词**，所以业务提示词一律来自版本，不用用户手填
        system: pv.system,
        prompt: testCase.input,
        temperature: pv.thinking ? undefined : (pv.temperature ?? undefined),
        maxOutputTokens: pv.maxOutputTokens ?? undefined,
        thinking: pv.thinking,
        reasoningEffort: pv.reasoningEffort as 'low' | 'high' | 'max' | undefined,
      })

      output = answer.text
      inputTokens = answer.usage.inputTokens
      outputTokens = answer.usage.outputTokens
      latencyMs = answer.latencyMs
    } catch (err) {
      // 被测调用失败就不打分了：没东西可评。失败照样记一条，这是项目一贯的原则
      error = `被测调用失败：${describeError(err)}`
    }

    // ---- 2. judge 打分（只有被测调用成功才走） ----
    let score: number | null = null
    let scoreReason: string | null = null
    let judgeInputTokens: number | null = null
    let judgeOutputTokens: number | null = null

    if (output !== null) {
      const verdict = await judgeAnswer({
        judgeModel: evalRun.judgeModel,
        question: testCase.input,
        reference: testCase.reference,
        answer: output,
      })

      score = verdict.score
      scoreReason = verdict.reason
      judgeInputTokens = verdict.usage.inputTokens
      judgeOutputTokens = verdict.usage.outputTokens
      // judge 失败不影响「被测回答已经拿到」这个事实，所以两个错误分开记
      if (verdict.error) error = verdict.error
    }

    // ---- 3. 落库 ----
    let result: EvalResult
    try {
      result = await prisma.evalResult.create({
        data: {
          evalRunId: id,
          caseId,
          output,
          score,
          scoreReason,
          inputTokens,
          outputTokens,
          latencyMs,
          judgeInputTokens,
          judgeOutputTokens,
          error,
        },
      })
    } catch (err) {
      // 并发请求抢同一格：另一个请求已经写进去了。读回来返回，不算失败
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        const raced = await prisma.evalResult.findUnique({
          where: { evalRunId_caseId: { evalRunId: id, caseId } },
        })
        if (raced) return NextResponse.json({ result: serializeResult(raced), cached: true })
      }
      throw err
    }

    // ---- 4. 全部跑完了就把这次评测标记为完成 ----
    const doneCount = await prisma.evalResult.count({ where: { evalRunId: id } })
    if (doneCount >= evalRun.caseCount) {
      await prisma.evalRun.update({
        where: { id },
        data: { status: 'done', finishedAt: new Date() },
      })
    }

    return NextResponse.json({
      result: serializeResult(result),
      doneCount,
      caseCount: evalRun.caseCount,
    })
  } catch (err) {
    console.error(`[POST /api/evals/${id}/cases/${caseId}] 失败：`, err)
    return NextResponse.json({ error: describeError(err) }, { status: 500 })
  }
}
