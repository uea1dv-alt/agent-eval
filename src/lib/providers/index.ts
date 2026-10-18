import { deepseekProvider } from './deepseek'
import type { LLMProvider } from './types'

/**
 * provider 注册表。
 *
 * 加新 provider 的完整流程：
 *   1. 新建 src/lib/providers/xxx.ts，实现 LLMProvider 接口
 *   2. 在这里 import 并加进 registry
 * 就这两步。页面、API 路由、数据库层全都不用动 —— 这就是 adapter 层的意义。
 */
export const providers: Record<string, LLMProvider> = {
  [deepseekProvider.id]: deepseekProvider,
}

export const DEFAULT_PROVIDER_ID = deepseekProvider.id

export function getProvider(id: string): LLMProvider {
  const provider = providers[id]
  if (!provider) {
    const known = Object.keys(providers).join(', ')
    throw new Error(`未知的 provider: "${id}"。已注册的有：${known}`)
  }
  return provider
}

/** 给前端用的 provider 列表（去掉 chat 方法，只留元数据，避免函数无法序列化） */
export function listProviderMeta() {
  return Object.values(providers).map((p) => ({
    id: p.id,
    label: p.label,
    models: p.models,
  }))
}

export type {
  LLMProvider,
  LLMCallParams,
  LLMCallResult,
  ModelInfo,
  TokenUsage,
  ReasoningEffort,
  SpanType,
  AgentTool,
  AgentParams,
  AgentEvent,
} from './types'
