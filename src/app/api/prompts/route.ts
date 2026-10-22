import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { describeError } from '@/lib/errors'
import { DEFAULT_PROVIDER_ID, getProvider } from '@/lib/providers'

const bodySchema = z.object({
  name: z.string().trim().min(1, '版本要有名字，例如 v1-简洁').max(80),
  system: z.string().trim().min(1, 'system 提示词不能为空'),
  /**
   * 模型和采样参数也存进版本里。
   * 为什么：换了模型，两个版本就不可比了 —— 比出来的差异分不清是提示词的功劳
   * 还是模型的功劳。把它们绑在版本上，「同名版本 = 同一组条件」才成立。
   */
  model: z.string().min(1, '必须选一个模型'),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).max(384_000).optional(),
  thinking: z.boolean().default(false),
  reasoningEffort: z.enum(['low', 'high', 'max']).optional(),
})

/** 新建一个 prompt 版本 */
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

  const data = parsed.data

  // 模型名在**录入时**就校验，而不是等到真花钱调用时才让厂商返回 400。
  // 一个写错的模型名会卡住整批评测：每条用例都要失败一次，才知道错在哪。
  const provider = getProvider(DEFAULT_PROVIDER_ID)
  if (!provider.models.some((m) => m.id === data.model)) {
    const known = provider.models.map((m) => m.id).join(', ')
    return NextResponse.json(
      { error: `未知的模型 "${data.model}"。可选：${known}` },
      { status: 400 },
    )
  }

  try {
    const version = await prisma.promptVersion.create({
      data: {
        name: data.name,
        system: data.system,
        model: data.model,
        temperature: data.temperature,
        maxOutputTokens: data.maxOutputTokens,
        thinking: data.thinking,
        reasoningEffort: data.reasoningEffort,
      },
    })

    return NextResponse.json({ promptVersion: version })
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      return NextResponse.json({ error: `已经有叫「${data.name}」的版本了` }, { status: 409 })
    }
    console.error('[POST /api/prompts] 失败：', err)
    return NextResponse.json({ error: describeError(err) }, { status: 500 })
  }
}

/** 列出所有 prompt 版本 */
export async function GET() {
  const prompts = await prisma.promptVersion.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json({ prompts })
}
