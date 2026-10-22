import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { describeError } from '@/lib/errors'

/** 一条用例：题目必填，参考答案可选 */
const caseSchema = z.object({
  input: z.string().trim().min(1, '题目不能为空'),
  /** 空字符串按「没填」处理 —— 前端的多行文本框总会给出 ''，而不是 undefined */
  reference: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined)),
})

const bodySchema = z.object({
  name: z.string().trim().min(1, '数据集要有名字').max(80, '名字太长了'),
  description: z
    .string()
    .trim()
    .max(500, '描述太长了')
    .optional()
    .transform((v) => (v ? v : undefined)),
  cases: z.array(caseSchema).min(1, '至少要有一条用例'),
})

/**
 * 新建数据集。
 *
 * 用例**在同一个请求里一起提交**（不是先建数据集再一条条加）：
 * 一个只有名字、没有用例的数据集没法跑评测，是半成品状态。
 * 打包提交就不会出现这种中间态。
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

  const { name, description, cases } = parsed.data

  try {
    const dataset = await prisma.dataset.create({
      data: {
        name,
        description,
        // position 按录入顺序写死。不能靠 createdAt 排 ——
        // 批量插入时几条记录的时间戳可能完全一样，顺序就随机了
        cases: {
          create: cases.map((c, i) => ({
            input: c.input,
            reference: c.reference,
            position: i,
          })),
        },
      },
      include: { _count: { select: { cases: true } } },
    })

    return NextResponse.json({
      dataset: { id: dataset.id, name: dataset.name, caseCount: dataset._count.cases },
    })
  } catch (err) {
    // P2002 = 唯一约束冲突。name 是 unique，撞名时给一句人话，
    // 而不是把 Prisma 的原始报错丢给前端
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      return NextResponse.json({ error: `已经有叫「${name}」的数据集了` }, { status: 409 })
    }
    console.error('[POST /api/datasets] 失败：', err)
    return NextResponse.json({ error: describeError(err) }, { status: 500 })
  }
}

/** 列出数据集（给验证脚本和将来的下拉框用） */
export async function GET() {
  const datasets = await prisma.dataset.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { cases: true } } },
  })

  return NextResponse.json({
    datasets: datasets.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      caseCount: d._count.cases,
      createdAt: d.createdAt,
    })),
  })
}
