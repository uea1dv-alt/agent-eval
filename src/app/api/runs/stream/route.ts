import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { StreamEvent } from '@/lib/agent/events'
import { DEFAULT_AGENT_SYSTEM } from '@/lib/agent/prompt'
import { encodeSse } from '@/lib/agent/sse'
import { prisma } from '@/lib/db'
import { describeError } from '@/lib/errors'
import { DEFAULT_PROVIDER_ID, getProvider, type TokenUsage } from '@/lib/providers'
import { serializeSpan } from '@/lib/spans'
import { agentTools } from '@/lib/tools'

/**
 * Vercel 函数默认最多跑 10 秒（Hobby 套餐上限 60 秒）。
 * 多步 agent 跑三步就可能超过 10 秒，不写这个会中途被掐断 ——
 * 而且掐断时不会报错，流就那么停了，看起来像「模型没反应」。
 */
export const maxDuration = 60

const runBodySchema = z.object({
  providerId: z.string().min(1).default(DEFAULT_PROVIDER_ID),
  model: z.string().min(1, '必须选一个模型'),
  prompt: z.string().min(1, 'prompt 不能为空'),
  system: z.string().optional(),
  /** 步数上限。给个默认值，免得每次都要手填 */
  maxSteps: z.number().int().min(1).max(12).default(6),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(1).max(384_000).optional(),
  thinking: z.boolean().default(false),
  reasoningEffort: z.enum(['low', 'high', 'max']).optional(),
})

/**
 * 跑一次多步 agent，边跑边落库，边把过程推给前端（SSE）。
 *
 * 和 `/api/runs`（单次调用）的区别：
 *   - 那边是「一问一答」，等模型全部生成完再一次性返回
 *   - 这边是 agent 循环，可能跑好几步、调好几次工具，所以必须流式 ——
 *     否则用户要盯着白屏等十几秒，也看不出卡在哪一步
 *
 * **为什么落库要写在路由里而不是 provider 里**：
 * provider 层的职责是「跟模型厂商打交道」，它不该知道我们有 span 表。
 * 分开之后，换个 provider 不用重写落库逻辑；落库逻辑改字段也不用碰 provider。
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

  // 关键：**所有校验必须在开始推流之前做完**。
  // 一旦返回了 200 + text/event-stream，HTTP 头就发出去了，
  // 后面再想回 400 是不可能的 —— 只能把错误塞进流里当一条事件。
  // 所以 getProvider 的「未知 provider」也在这里拦掉。
  let provider
  try {
    provider = getProvider(params.providerId)
  } catch (err) {
    return NextResponse.json({ error: describeError(err) }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const runId = crypto.randomUUID()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // 客户端可能中途关页面。那时 enqueue 会抛异常 ——
      // 不能让它把整条流水线带崩，因为**这次运行的数据还是要记下来**。
      let clientGone = false

      const send = (event: StreamEvent) => {
        if (clientGone) return
        try {
          // 第二个参数是 SSE 的 event 名。浏览器 EventSource 靠它区分事件类型，
          // 我们自己手写的解析器也读它 —— 顺便让人用 curl 看的时候一眼能看懂。
          controller.enqueue(encoder.encode(encodeSse(event, event.type)))
        } catch {
          clientGone = true
        }
      }

      /** 写库失败不中断整条流：已经在 SSE 里了，回不去 500。记日志 + 推一条 error 让用户知道数据不全 */
      async function persist<T>(label: string, action: () => Promise<T>): Promise<T | null> {
        try {
          return await action()
        } catch (err) {
          console.error(`[POST /api/runs/stream] ${label}失败：`, err)
          send({ type: 'error', message: `${label}失败：${describeError(err)}` })
          return null
        }
      }

      const startedAt = performance.now()
      const rootId = crypto.randomUUID()

      let finalText = ''
      let stepCount = 0
      let finishReason: string | undefined
      let runError: string | undefined
      let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }

      // 当前这一步的 llm_call span id。工具 span 要挂在它下面
      let currentCallId: string | null = null
      // SDK 的 toolCallId → 我们的 tool_call span id。模型可能一轮调多个工具，必须按 id 配对
      const toolSpanIds = new Map<string, string>()

      // 根节点：一次 agent 运行一个 agent_run span，parentId 为 null。
      // 为什么要有这一层：它把「一次运行」变成一个实体，
      // 于是总耗时、总 token、最终答案是**一次运行自己的属性**，而不是靠把子节点加起来算。
      const rootRow = await persist('写入 agent_run', () =>
        prisma.span.create({
          data: {
            id: rootId,
            runId,
            parentId: null,
            type: 'agent_run',
            name: 'Agent 运行',
            input: JSON.stringify({
              prompt: params.prompt,
              system: params.system ?? DEFAULT_AGENT_SYSTEM,
              model: params.model,
              maxSteps: params.maxSteps,
              temperature: params.thinking ? undefined : params.temperature,
              maxOutputTokens: params.maxOutputTokens,
              thinking: params.thinking,
              reasoningEffort: params.reasoningEffort,
            }),
            model: params.model,
          },
        }),
      )

      // 根节点都没写进去，说明数据库有问题。这时候继续跑没有意义 ——
      // 跑出来的东西一条都存不下来，而这是个记录本。
      if (!rootRow) {
        send({ type: 'error', message: '根 span 写入失败，已中止这次运行' })
        controller.close()
        return
      }

      send({ type: 'run_start', runId, span: serializeSpan(rootRow) })

      try {
        for await (const event of provider.runAgent(
          {
            model: params.model,
            prompt: params.prompt,
            system: params.system ?? DEFAULT_AGENT_SYSTEM,
            maxSteps: params.maxSteps,
            temperature: params.temperature,
            maxOutputTokens: params.maxOutputTokens,
            thinking: params.thinking,
            reasoningEffort: params.reasoningEffort,
          },
          agentTools,
        )) {
          // 先原样转发给前端 —— 打字机效果靠的是它，不能等落库
          send({ type: 'agent', event })

          switch (event.type) {
            // 模型开始一步 → 立刻建一条 llm_call，树就长出一个新节点
            case 'step_start': {
              const id = crypto.randomUUID()
              currentCallId = id
              stepCount = event.step

              const row = await persist('写入 llm_call', () =>
                prisma.span.create({
                  data: {
                    id,
                    runId,
                    parentId: rootId,
                    type: 'llm_call',
                    name: `第 ${event.step} 步`,
                    input: JSON.stringify({
                      step: event.step,
                      model: params.model,
                      temperature: params.thinking ? undefined : params.temperature,
                      maxOutputTokens: params.maxOutputTokens,
                      thinking: params.thinking,
                      reasoningEffort: params.reasoningEffort,
                    }),
                    model: params.model,
                  },
                }),
              )
              if (row) send({ type: 'span', span: serializeSpan(row) })
              break
            }

            // 模型要调工具 → 建 tool_call，父节点是**发起这次调用的那次 llm_call**。
            // 这一层父子关系就是 trace 树的价值：一眼看出哪个工具是被哪一步决策调起来的
            case 'tool_call': {
              const id = crypto.randomUUID()
              toolSpanIds.set(event.toolCallId, id)

              const row = await persist('写入 tool_call', () =>
                prisma.span.create({
                  data: {
                    id,
                    runId,
                    parentId: currentCallId ?? rootId,
                    type: 'tool_call',
                    name: event.toolName,
                    input: JSON.stringify({ toolName: event.toolName, args: event.input }),
                  },
                }),
              )
              if (row) send({ type: 'span', span: serializeSpan(row) })
              break
            }

            // 工具跑完了 → 补上结果和耗时。失败也补，写进 output.error
            case 'tool_result': {
              const id = toolSpanIds.get(event.toolCallId)
              if (!id) break

              const row = await persist('更新 tool_call', () =>
                prisma.span.update({
                  where: { id },
                  data: {
                    output: JSON.stringify(
                      event.error ? { error: event.error } : { result: event.output },
                    ),
                    latencyMs: event.latencyMs,
                  },
                }),
              )
              if (row) send({ type: 'span', span: serializeSpan(row) })
              break
            }

            // 一步结束 → 把这一步的正文、token、耗时补进 llm_call
            case 'step_end': {
              finishReason = event.finishReason
              const callId = currentCallId
              if (!callId) break

              const row = await persist('更新 llm_call', () =>
                prisma.span.update({
                  where: { id: callId },
                  data: {
                    output: JSON.stringify({
                      text: event.text,
                      reasoningText: event.reasoningText,
                      finishReason: event.finishReason,
                    }),
                    inputTokens: event.usage.inputTokens,
                    outputTokens: event.usage.outputTokens,
                    latencyMs: event.latencyMs,
                  },
                }),
              )
              if (row) send({ type: 'span', span: serializeSpan(row) })
              break
            }

            case 'done': {
              finalText = event.text
              totalUsage = event.usage
              stepCount = event.stepCount
              break
            }

            case 'error': {
              runError = event.message
              break
            }
          }
        }
      } catch (err) {
        // provider 层已经尽量不抛了，走到这里说明是更外层的意外
        runError = describeError(err)
        send({ type: 'error', message: runError })
      }

      const latencyMs = Math.round(performance.now() - startedAt)

      // 收尾：把这次运行的总账写进根节点。
      // 注意这里用的是**累计** usage（totalUsage），不是最后一步的 ——
      // 三步的 agent，根节点该显示三步加起来花了多少 token。
      const finalRoot = await persist('更新 agent_run', () =>
        prisma.span.update({
          where: { id: rootId },
          data: {
            output: JSON.stringify({
              text: finalText,
              stepCount,
              finishReason,
              ...(runError ? { error: runError } : {}),
            }),
            inputTokens: totalUsage.inputTokens,
            outputTokens: totalUsage.outputTokens,
            latencyMs,
          },
        }),
      )
      if (finalRoot) send({ type: 'span', span: serializeSpan(finalRoot) })

      send({ type: 'run_end', runId, latencyMs })

      try {
        controller.close()
      } catch {
        // 已经关了就算了
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform 是叫中间的代理别自作主张压缩/改写
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx 之类的反代会把响应攒够一块再发，那样「流式」就名存实亡了
      'X-Accel-Buffering': 'no',
    },
  })
}
