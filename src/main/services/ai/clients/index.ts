import type { AiClient, ResolvedProvider } from '../types'
import { OpenAiChatClient } from './openai-chat'
import { OpenAiResponsesClient } from './openai-responses'
import { AnthropicClient } from './anthropic'
import { GeminiClient } from './gemini'
import { CodexClient } from './codex'

export interface CreateClientOptions {
  /** Codex 刷新令牌后的回写；不传则刷新结果只保留在内存 */
  persistCredential?: (providerId: string, credentialJson: string) => void
}

export function createAiClient(
  provider: ResolvedProvider,
  options: CreateClientOptions = {}
): AiClient {
  switch (provider.protocol) {
    case 'openai-chat':
      return new OpenAiChatClient(provider)
    case 'openai-responses':
      return new OpenAiResponsesClient(provider)
    case 'anthropic':
      return new AnthropicClient(provider)
    case 'gemini':
      return new GeminiClient(provider)
    case 'codex':
      return new CodexClient(provider, (json) => options.persistCredential?.(provider.id, json))
    default: {
      const never: never = provider.protocol
      throw new Error(`未知的 AI 协议：${String(never)}`)
    }
  }
}

export { CODEX_KNOWN_MODELS, CODEX_BASE_URL } from './codex'
