import type {
  AiClient,
  AiModelInfo,
  ResolvedProvider,
  VisionRequest,
  VisionResponse
} from '../types'
import { bearerHeaders, fetchJson, normalizeBaseUrl } from '../http'
import { OpenAiChatClient } from './openai-chat'
import { OpenAiResponsesClient } from './openai-responses'
import { AnthropicClient } from './anthropic'
import { GeminiClient } from './gemini'

export const OPENCODE_ZEN_BASE_URL = 'https://opencode.ai/zen/v1'
export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1'

/** Zen 网关按上游厂商暴露不同接口；用模型 id 判断该走哪一个（与 OpenCode 自己的路由规则一致） */
export function opencodeRouteOf(model: string): 'responses' | 'anthropic' | 'gemini' | 'chat' {
  const id = model.trim().toLowerCase()
  if (/^(gpt-|o\d|codex)/.test(id)) return 'responses'
  if (id.startsWith('claude')) return 'anthropic'
  if (id.startsWith('gemini')) return 'gemini'
  return 'chat'
}

/**
 * OpenCode Zen / Go：一个 API Key 访问全部模型。
 * 同一个 baseUrl 下 GPT 走 /responses、Claude 走 /messages、Gemini 走 /models/x:generateContent，
 * 其余（DeepSeek / Kimi / Qwen / MiniMax…）走 /chat/completions；对用户只暴露「选模型」。
 */
export class OpenCodeClient implements AiClient {
  private readonly baseUrl: string
  private readonly delegate: AiClient

  constructor(private readonly provider: ResolvedProvider) {
    this.baseUrl = normalizeBaseUrl(provider.baseUrl, true)
    const routed: ResolvedProvider = { ...provider, baseUrl: this.baseUrl }
    switch (opencodeRouteOf(provider.model)) {
      case 'responses':
        this.delegate = new OpenAiResponsesClient(routed)
        break
      case 'anthropic':
        this.delegate = new AnthropicClient(routed)
        break
      case 'gemini':
        this.delegate = new GeminiClient(routed, { versionPath: '' })
        break
      default:
        this.delegate = new OpenAiChatClient(routed)
    }
  }

  complete(request: VisionRequest): Promise<VisionResponse> {
    return this.delegate.complete(request)
  }

  verify(): Promise<void> {
    return this.delegate.verify()
  }

  /** /models 对 Zen 与 Go 都是 OpenAI 格式的列表，和当前选的模型走哪条路无关 */
  async listModels(): Promise<AiModelInfo[] | null> {
    const response = await fetchJson(`${this.baseUrl}/models`, {
      method: 'GET',
      headers: bearerHeaders(this.provider.credential),
      timeoutMs: 20_000
    })
    const data = (await response.json()) as { data?: { id: string }[] }
    return (data.data ?? []).map((m) => ({ id: m.id })).sort((a, b) => a.id.localeCompare(b.id))
  }
}
