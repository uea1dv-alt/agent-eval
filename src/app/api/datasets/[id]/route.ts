import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { describeError } from '@/lib/errors'

/**
 * 数据集详情，带全部用例。
 *
 * 页面上是服务端组件直接查库，不走这个接口 —— 这里主要是给脚本用
 * （逐条评测要先拿到 caseId），顺便将来做「按数据集导出」也方便。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  try {
    const dataset = await prisma.dataset.findUnique({
      where: { id },
      include: { cases: { orderBy: { position: 'asc' } } },
    })

    if (!dataset) return NextResponse.json({ error: '数据集不存在' }, { status: 404 })

    return NextResponse.json({
      dataset: {
        id: dataset.id,
        name: dataset.name,
        description: dataset.description,
        createdAt: dataset.createdAt,
        cases: dataset.cases.map((c) => ({
          id: c.id,
          input: c.input,
          reference: c.reference,
          position: c.position,
        })),
      },
    })
  } catch (err) {
    console.error(`[GET /api/datasets/${id}] 失败：`, err)
    return NextResponse.json({ error: describeError(err) }, { status: 500 })
  }
}
