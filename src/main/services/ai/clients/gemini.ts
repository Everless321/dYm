import type {
  AiClient,
  AiModelInfo,
  ResolvedProvider,
  VisionRequest,
  VisionResponse
} from '../types'
import { fetchJson, normalizeBaseUrl } from '../http'

interface GeminiResponse {
  modelVersion?: string
  candidates?: { content?: { parts?: { text?: string }[] } }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

/** Google Gemini generateContent。baseUrl 填到主机即可（默认 https://generativelanguage.googleapis.com） */
export class GeminiClient implements AiClient {
  private readonly baseUrl: string
  /** 官方是 /v1beta；OpenCode Zen 等网关把 Gemini 挂在自己的 /v1 下，传空串表示 baseUrl 已含版本 */
  private readonly versionPath: string

  constructor(
    private readonly provider: ResolvedProvider,
    options: { versionPath?: string } = {}
  ) {
    const base = normalizeBaseUrl(provider.baseUrl)
    if (options.versionPath === undefined) {
      this.baseUrl = base.replace(/\/v1(beta)?$/, '')
      this.versionPath = '/v1beta'
    } else {
      this.baseUrl = base
      this.versionPath = options.versionPath
    }
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.provider.extraHeaders
    }
    if (this.provider.credential.trim()) headers['x-goog-api-key'] = this.provider.credential.trim()
    return headers
  }

  private modelUrl(action: string): string {
    return `${this.baseUrl}${this.versionPath}/models/${encodeURIComponent(this.provider.model)}:${action}`
  }

  async complete(request: VisionRequest): Promise<VisionResponse> {
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: [
        {
          role: 'user',
          parts: [
            { text: request.prompt },
            ...request.images.map((img) => ({
              inlineData: { mimeType: img.mime, data: img.data.toString('base64') }
            }))
          ]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: request.maxOutputTokens ?? 1024,
        ...(request.json ? { responseMimeType: 'application/json' } : {})
      }
    }
    const response = await fetchJson(this.modelUrl('generateContent'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: request.signal
    })
    const data = (await response.json()) as GeminiResponse
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    return {
      text,
      model: data.modelVersion,
      usage: data.usageMetadata
        ? {
            input: data.usageMetadata.promptTokenCount,
            output: data.usageMetadata.candidatesTokenCount
          }
        : undefined
    }
  }

  async verify(): Promise<void> {
    await fetchJson(this.modelUrl('generateContent'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        generationConfig: { maxOutputTokens: 5 }
      }),
      timeoutMs: 30_000
    })
  }

  async listModels(): Promise<AiModelInfo[] | null> {
    try {
      const response = await fetchJson(`${this.baseUrl}${this.versionPath}/models?pageSize=200`, {
        method: 'GET',
        headers: this.headers(),
        timeoutMs: 20_000
      })
      const data = (await response.json()) as {
        models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[]
      }
      return (data.models ?? [])
        .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName }))
    } catch {
      return null
    }
  }
}
