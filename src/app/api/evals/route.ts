import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { describeError } from '@/lib/errors'
import { pickJudgeModel } from '@/lib/eval/judge'

const bodySchema = z.object({
  datasetId: z.string().min(1, '要选一个数据集'),
  promptVersionId: z.string().min(1, '要选一个 prompt 版本'),
  /** 不传就用默认 judge（并自动避开被测模型） */
  judgeModel: z.string().min(1).optional(),
})

/**
 * 发起一次评测 = 一个数据集 × 一个 prompt 版本。
 *
 * 这个请求**不跑模型**，只建一条状态为 running 的评测记录。
 * 真正跑用例的是 `/api/evals/[id]/cases/[caseId]`，由前端逐条调用。
 *
 * 为什么拆成两个请求：一次评测可能是几十条用例，每条要两次模型调用
 * （被测 + judge）。Vercel 的函数最多跑 60 秒，整批塞进一个请求必然超时；
 * 而且超时之后你不知道跑到哪了。逐条跑的话，断了还能接着跑 ——
 * 已经跑完的用例有结果记录，重试会直接复用，不会重复花钱。
 */
export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: '参数不合法', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { datasetId, promptVersionId, judgeModel } = parsed.data

  try {
    const [dataset, promptVersion] = await Promise.all([
      prisma.dataset.findUnique({
        where: { id: datasetId },
        include: { _count: { select: { cases: true } } },
      }),
      prisma.promptVersion.findUnique({ where: { id: promptVersionId } }),
    ])

    if (!dataset) return NextResponse.json({ error: '数据集不存在' }, { status: 404 })
    if (!promptVersion) {
      return NextResponse.json({ error: 'prompt 版本不存在' }, { status: 404 })
    }
    if (dataset._count.cases === 0) {
      return NextResponse.json({ error: '这个数据集还没有用例' }, { status: 400 })
    }

    // 关键约束：judge 不能是被评模型。调用方传了什么都要再过一遍这里
    const judge = pickJudgeModel(promptVersion.model, judgeModel)

    const evalRun = await prisma.evalRun.create({
      data: {
        datasetId,
        promptVersionId,
        judgeModel: judge,
        // 快照当下的用例数。数据集以后被增删，已跑完的这次评测的进度条不能跟着变
        caseCount: dataset._count.cases,
      },
    })

    return NextResponse.json({
      evalRun: {
        id: evalRun.id,
        judgeModel: evalRun.judgeModel,
        caseCount: evalRun.caseCount,
        testedModel: promptVersion.model,
      },
    })
  } catch (err) {
    console.error('[POST /api/evals] 失败：', err)
    return NextResponse.json({ error: describeError(err) }, { status: 500 })
  }
}

/** 列出评测记录 */
export async function GET() {
  const evals = await prisma.evalRun.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      dataset: { select: { name: true } },
      promptVersion: { select: { name: true, model: true } },
      _count: { select: { results: true } },
    },
  })

  return NextResponse.json({
    evals: evals.map((e) => ({
      id: e.id,
      datasetName: e.dataset.name,
      promptName: e.promptVersion.name,
      testedModel: e.promptVersion.model,
      judgeModel: e.judgeModel,
      status: e.status,
      caseCount: e.caseCount,
      doneCount: e._count.results,
      createdAt: e.createdAt,
    })),
  })
}
