import { randomUUID } from 'crypto'
import { app } from 'electron'
import type {
  AiClient,
  AiModelInfo,
  ResolvedProvider,
  VisionRequest,
  VisionResponse
} from '../types'
import { AiHttpError } from '../types'
import { bearerHeaders, fetchJson, normalizeBaseUrl } from '../http'
import { OpenAiChatClient } from './openai-chat'
import { OpenAiResponsesClient } from './openai-responses'
import { AnthropicClient } from './anthropic'
import { GeminiClient } from './gemini'

export const OPENCODE_ZEN_BASE_URL = 'https://opencode.ai/zen/v1'
export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1'

export type OpenCodeRoute = 'responses' | 'anthropic' | 'gemini' | 'chat'

const ALL_ROUTES: OpenCodeRoute[] = ['chat', 'responses', 'anthropic', 'gemini']

export function isOpenCodeGoUrl(baseUrl: string): boolean {
  return /\/zen\/go(\/|$)/i.test(baseUrl)
}

/**
 * 按 OpenCode 文档的「模型 → 接口」表猜首选路由（Zen 与 Go 各自的表略有出入：
 * MiniMax 在 Zen 走 chat/completions、在 Go 走 messages）。猜错时由客户端按 ModelError 回退到其它路由。
 */
export function opencodeRouteOf(model: string, baseUrl = ''): OpenCodeRoute {
  const id = model.trim().toLowerCase()
  if (/^(gpt-|o\d|codex|grok-|muse-)/.test(id)) return 'responses'
  if (id.startsWith('claude') || id.startsWith('qwen')) return 'anthropic'
  if (id.startsWith('minimax') && isOpenCodeGoUrl(baseUrl)) return 'anthropic'
  if (id.startsWith('gemini')) return 'gemini'
  return 'chat'
}

/** 网关对「模型不属于这个接口族」的回应：401/400 + type=ModelError / "is not supported" */
function isModelRouteError(error: unknown): boolean {
  if (!(error instanceof AiHttpError)) return false
  if (error.status !== 400 && error.status !== 401 && error.status !== 404) return false
  const text = `${error.message} ${error.body ?? ''}`
  return /ModelError|is not supported|not supported/i.test(text)
}

/** 进程内记住每个 (baseUrl, model) 实际跑通的路由，避免每条请求都先撞一次错 */
const resolvedRoutes = new Map<string, OpenCodeRoute>()

/**
 * OpenCode Zen / Go：一个 API Key 访问全部模型。
 * 同一个 baseUrl 下 GPT / Grok 走 /responses、Claude / Qwen 走 /messages、Gemini 走 /models/x:generateContent，
 * 其余（DeepSeek / Kimi / GLM…）走 /chat/completions；对用户只暴露「选模型」。
 * Go 侧要求客户端带自己的 User-Agent 与稳定的 x-opencode-session，这里统一补上。
 */
export class OpenCodeClient implements AiClient {
  private readonly baseUrl: string
  private readonly routed: ResolvedProvider
  private readonly delegates = new Map<OpenCodeRoute, AiClient>()
  private readonly cacheKey: string

  constructor(private readonly provider: ResolvedProvider) {
    this.baseUrl = normalizeBaseUrl(provider.baseUrl, true)
    this.cacheKey = `${this.baseUrl}|${provider.model.trim().toLowerCase()}`
    this.routed = {
      ...provider,
      baseUrl: this.baseUrl,
      extraHeaders: {
        ...provider.extraHeaders,
        'User-Agent': `dym/${safeAppVersion()}`,
        'x-opencode-session': randomUUID()
      }
    }
  }

  private delegate(route: OpenCodeRoute): AiClient {
    let client = this.delegates.get(route)
    if (!client) {
      switch (route) {
        case 'responses':
          client = new OpenAiResponsesClient(this.routed)
          break
        case 'anthropic':
          client = new AnthropicClient(this.routed)
          break
        case 'gemini':
          client = new GeminiClient(this.routed, { versionPath: '' })
          break
        default:
          client = new OpenAiChatClient(this.routed)
      }
      this.delegates.set(route, client)
    }
    return client
  }

  /** 首选路由排最前，其余按常见程度兜底 */
  private candidates(): OpenCodeRoute[] {
    const remembered = resolvedRoutes.get(this.cacheKey)
    const primary = remembered ?? opencodeRouteOf(this.provider.model, this.baseUrl)
    return [primary, ...ALL_ROUTES.filter((r) => r !== primary)]
  }

  private async withFallback<T>(run: (client: AiClient) => Promise<T>): Promise<T> {
    const routes = this.candidates()
    let lastError: unknown
    for (const route of routes) {
      try {
        const result = await run(this.delegate(route))
        resolvedRoutes.set(this.cacheKey, route)
        return result
      } catch (error) {
        lastError = error
        if (!isModelRouteError(error)) throw error
        // 记住的路由失效了（模型被网关挪到别的接口），清掉后继续试下一个
        if (resolvedRoutes.get(this.cacheKey) === route) resolvedRoutes.delete(this.cacheKey)
      }
    }
    throw lastError
  }

  complete(request: VisionRequest): Promise<VisionResponse> {
    return this.withFallback((client) => client.complete(request))
  }

  verify(): Promise<void> {
    return this.withFallback((client) => client.verify())
  }

  /** /models 对 Zen 与 Go 都是 OpenAI 格式的列表，和当前选的模型走哪条路无关 */
  async listModels(): Promise<AiModelInfo[] | null> {
    const response = await fetchJson(`${this.baseUrl}/models`, {
      method: 'GET',
      headers: bearerHeaders(this.provider.credential, this.routed.extraHeaders),
      timeoutMs: 20_000
    })
    const data = (await response.json()) as { data?: { id: string }[] }
    return (data.data ?? []).map((m) => ({ id: m.id })).sort((a, b) => a.id.localeCompare(b.id))
  }
}

function safeAppVersion(): string {
  try {
    return app?.getVersion?.() || 'dev'
  } catch {
    return 'dev'
  }
}
