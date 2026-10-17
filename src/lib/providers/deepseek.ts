import { createDeepSeek } from '@ai-sdk/deepseek'
import { generateText } from 'ai'
import type { LLMCallParams, LLMCallResult, LLMProvider, ModelInfo } from './types'

/**
 * DeepSeek provider 实现。
 *
 * 这是全项目**唯一**读取 DEEPSEEK_API_KEY 的地方。
 * 别处要调模型，一律走 LLMProvider 接口，不要自己 new 客户端。
 */

/**
 * 可用模型。
 *
 * 踩坑记录：deepseek-chat / deepseek-reasoner 这两个老别名已于 2026-07-24 下线，
 * 现在必须用 deepseek-flash / deepseek-v4-pro。网上教程基本还写着老名字，照抄会 404。
 */
const MODELS: ModelInfo[] = [
  {
    id: 'deepseek-flash',
    label: 'DeepSeek V4.1 Flash',
    supportsThinking: true,
    supportsVision: true,
    description: '快且便宜，适合日常迭代和批量跑评测',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    supportsThinking: true,
    supportsVision: false,
    description: '能力更强、更贵，适合难题；不支持图片输入',
  },
]

// 惰性初始化：不在模块加载时读环境变量。
// 否则 `next build` 阶段就会因为拿不到 key 而炸掉。
let cached: ReturnType<typeof createDeepSeek> | null = null

function getClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    throw new Error('缺少环境变量 DEEPSEEK_API_KEY。请复制 .env.example 为 .env 并填入 key。')
  }
  cached ??= createDeepSeek({ apiKey })
  return cached
}

async function chat(params: LLMCallParams): Promise<LLMCallResult> {
  const thinking = params.thinking ?? false

  const startedAt = performance.now()

  const result = await generateText({
    model: getClient()(params.model),
    system: params.system,
    prompt: params.prompt,

    // 关键：thinking 开启时，DeepSeek 会完全忽略 temperature 和 topP。
    // 与其传一个「看起来生效其实被丢弃」的值，不如干脆不传 —— 免得误导。
    temperature: thinking ? undefined : params.temperature,
    maxOutputTokens: params.maxOutputTokens,

    providerOptions: {
      deepseek: {
        // DeepSeek V4 默认是开启 thinking 的。我们显式传值，让行为可预测：
        // 关掉 thinking 更快更便宜，而且 temperature 才有效。
        thinking: { type: thinking ? 'enabled' : 'disabled' },
        ...(thinking && params.reasoningEffort
          ? { reasoningEffort: params.reasoningEffort }
          : {}),
      },
    },
  })

  const latencyMs = Math.round(performance.now() - startedAt)

  return {
    text: result.text,
    // 是 reasoningText（字符串），不是 reasoning（数组，装的是各种 part）
    reasoningText: result.reasoningText,
    finishReason: result.finishReason,
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      totalTokens: result.usage.totalTokens ?? 0,
      // 注意路径：AI SDK 7 把细节字段收进了 outputTokenDetails，
      // 不是顶层的 usage.reasoningTokens。写错不会报错，只会静默拿到 undefined。
      reasoningTokens: result.usage.outputTokenDetails?.reasoningTokens,
    },
    latencyMs,
  }
}

export const deepseekProvider: LLMProvider = {
  id: 'deepseek',
  label: 'DeepSeek',
  models: MODELS,
  chat,
}
