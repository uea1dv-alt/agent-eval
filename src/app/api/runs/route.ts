import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { DEFAULT_PROVIDER_ID, getProvider, type TokenUsage } from '@/lib/providers'
import { serializeSpan, type SpanInputPayload, type SpanOutputPayload } from '@/lib/spans'

const runBodySchema = z.object({
  providerId: z.string().min(1).default(DEFAULT_PROVIDER_ID),
  model: z.string().min(1, '必须选一个模型'),
  prompt: z.string().min(1, 'prompt 不能为空'),
  system: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).max(384_000).optional(),
  thinking: z.boolean().default(false),
  reasoningEffort: z.enum(['low', 'high', 'max']).optional(),
})

/**
 * 跑一次 LLM 调用并落库。
 *
 * 返回 200 表示「这次请求处理成功」，不代表「模型调用成功」。
 * 模型调用失败时我们**照样写一条 span**，把错误记在 output.error 里，
 * 并用 ok: false 告诉前端。原因：评测平台里失败记录和成功记录一样有价值 ——
 * Stage 2 统计成功率、分析失败模式，全靠这些数据。
 */
export async function POST(req: Request) {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const parsed = runBodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: '参数不合法', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const params = parsed.data
  const provider = getProvider(params.providerId)

  const inputPayload: SpanInputPayload = {
    prompt: params.prompt,
    system: params.system,
    temperature: params.temperature,
    maxOutputTokens: params.maxOutputTokens,
    thinking: params.thinking,
    reasoningEffort: params.reasoningEffort,
  }

  // 一次运行一个 runId。Stage 0 每次运行只有一个 span，所以看起来有点多余，
  // 但 Stage 1 加多步 Agent 后，同一次运行的所有 span 会共享这个 id。
  const runId = crypto.randomUUID()

  let outputPayload: SpanOutputPayload
  let ok = true
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  let latencyMs: number | null = null
  let reasoningText: string | undefined

  try {
    const result = await provider.chat({
      model: params.model,
      prompt: params.prompt,
      system: params.system,
      temperature: params.temperature,
      maxOutputTokens: params.maxOutputTokens,
      thinking: params.thinking,
      reasoningEffort: params.reasoningEffort,
    })

    usage = result.usage
    latencyMs = result.latencyMs
    reasoningText = result.reasoningText
    outputPayload = {
      text: result.text,
      reasoningText: result.reasoningText,
      finishReason: result.finishReason,
    }
  } catch (err) {
    ok = false
    outputPayload = {
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const span = await prisma.span.create({
    data: {
      runId,
      parentId: null, // Stage 0 恒为 null，Stage 1 才写值
      type: 'llm_call',
      name: params.model,
      input: JSON.stringify(inputPayload),
      output: JSON.stringify(outputPayload),
      model: params.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      latencyMs,
    },
  })

  return NextResponse.json({
    ok,
    span: serializeSpan(span),
    // 思维链正文单独返回，方便前端立即展示（也已经在 output 里存了一份）
    reasoningText,
  })
}

/** 列出最近的调用记录 */
export async function GET(req: Request) {
  const limitParam = new URL(req.url).searchParams.get('limit')
  const take = Math.min(Math.max(Number(limitParam) || 50, 1), 200)

  const spans = await prisma.span.findMany({
    orderBy: { createdAt: 'desc' },
    take,
  })

  return NextResponse.json({ spans: spans.map(serializeSpan) })
}
