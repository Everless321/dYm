import type {
  AiClient,
  AiModelInfo,
  ResolvedProvider,
  VisionRequest,
  VisionResponse
} from '../types'
import { fetchJson, normalizeBaseUrl } from '../http'

interface AnthropicResponse {
  model?: string
  content?: { type?: string; text?: string }[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

/**
 * Anthropic Messages API。baseUrl 可以是 https://api.anthropic.com，
 * 也可以是 OpenCode Zen 这类转发（https://opencode.ai/zen），路径统一拼 /v1/messages。
 */
export class AnthropicClient implements AiClient {
  private readonly baseUrl: string

  constructor(private readonly provider: ResolvedProvider) {
    const base = normalizeBaseUrl(provider.baseUrl)
    this.baseUrl = base.endsWith('/v1') ? base.slice(0, -3) : base
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...this.provider.extraHeaders
    }
    if (this.provider.credential.trim()) headers['x-api-key'] = this.provider.credential.trim()
    return headers
  }

  async complete(request: VisionRequest): Promise<VisionResponse> {
    const body = {
      model: this.provider.model,
      max_tokens: request.maxOutputTokens ?? 1024,
      temperature: 0.3,
      system: request.system,
      messages: [
        {
          role: 'user',
          content: [
            ...request.images.map((img) => ({
              type: 'image',
              source: { type: 'base64', media_type: img.mime, data: img.data.toString('base64') }
            })),
            { type: 'text', text: request.prompt }
          ]
        }
      ]
    }
    const response = await fetchJson(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: request.signal
    })
    const data = (await response.json()) as AnthropicResponse
    const text = (data.content ?? [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('')
    return {
      text,
      model: data.model,
      usage: data.usage
        ? { input: data.usage.input_tokens, output: data.usage.output_tokens }
        : undefined
    }
  }

  async verify(): Promise<void> {
    await fetchJson(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.provider.model,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'Hi' }]
      }),
      timeoutMs: 30_000
    })
  }

  async listModels(): Promise<AiModelInfo[] | null> {
    try {
      const response = await fetchJson(`${this.baseUrl}/v1/models?limit=100`, {
        method: 'GET',
        headers: this.headers(),
        timeoutMs: 20_000
      })
      const data = (await response.json()) as { data?: { id: string; display_name?: string }[] }
      return (data.data ?? []).map((m) => ({ id: m.id, label: m.display_name }))
    } catch {
      return null
    }
  }
}
