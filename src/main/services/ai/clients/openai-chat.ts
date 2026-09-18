import type {
  AiClient,
  AiModelInfo,
  ResolvedProvider,
  VisionRequest,
  VisionResponse
} from '../types'
import { AiHttpError } from '../types'
import { bearerHeaders, fetchJson, normalizeBaseUrl, toDataUrl } from '../http'
import { parseSseText } from '../sse'

type ChatContent = string | { type: string; text?: string }[] | undefined

interface ChatChoice {
  message?: { content?: ChatContent }
  delta?: { content?: string }
}

interface ChatResponse {
  model?: string
  choices?: ChatChoice[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

function contentToText(content: ChatContent): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('')
  }
  return ''
}

/** 兼容两种响应：普通 JSON 与 SSE 流（部分网关即使未请求 stream 也返回 event-stream） */
function extractText(raw: string): { text: string; model?: string; usage?: ChatResponse['usage'] } {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('data:') && !trimmed.startsWith('event:')) {
    const data = JSON.parse(trimmed) as ChatResponse
    return {
      text: contentToText(data.choices?.[0]?.message?.content),
      model: data.model,
      usage: data.usage
    }
  }
  let text = ''
  let model: string | undefined
  for (const evt of parseSseText(trimmed) as ChatResponse[]) {
    model = model ?? evt.model
    const choice = evt.choices?.[0]
    text += choice?.delta?.content ?? contentToText(choice?.message?.content)
  }
  return { text, model }
}

export class OpenAiChatClient implements AiClient {
  private readonly baseUrl: string

  constructor(private readonly provider: ResolvedProvider) {
    this.baseUrl = normalizeBaseUrl(provider.baseUrl, true)
  }

  async complete(request: VisionRequest): Promise<VisionResponse> {
    const body: Record<string, unknown> = {
      model: this.provider.model,
      messages: [
        { role: 'system', content: request.system },
        {
          role: 'user',
          content: [
            { type: 'text', text: request.prompt },
            ...request.images.map((img) => ({
              type: 'image_url',
              image_url: { url: toDataUrl(img.mime, img.data) }
            }))
          ]
        }
      ],
      temperature: 0.3,
      max_tokens: request.maxOutputTokens ?? 1024
    }
    if (request.json) body.response_format = { type: 'json_object' }

    let response: Response
    try {
      response = await this.post(body, request.signal)
    } catch (error) {
      // 不支持 response_format 的服务（部分本地模型 / 网关）返回 400，去掉后重试一次
      if (
        request.json &&
        error instanceof AiHttpError &&
        error.status === 400 &&
        /response_format|json_object/i.test(error.body ?? '')
      ) {
        delete body.response_format
        response = await this.post(body, request.signal)
      } else {
        throw error
      }
    }
    const raw = await response.text()
    const { text, model, usage } = extractText(raw)
    return {
      text,
      model,
      usage: usage ? { input: usage.prompt_tokens, output: usage.completion_tokens } : undefined
    }
  }

  private post(body: unknown, signal?: AbortSignal): Promise<Response> {
    return fetchJson(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: bearerHeaders(this.provider.credential, this.provider.extraHeaders),
      body: JSON.stringify(body),
      signal
    })
  }

  async verify(): Promise<void> {
    await fetchJson(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: bearerHeaders(this.provider.credential, this.provider.extraHeaders),
      body: JSON.stringify({
        model: this.provider.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5
      }),
      timeoutMs: 30_000
    })
  }

  async listModels(): Promise<AiModelInfo[] | null> {
    try {
      const response = await fetchJson(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: bearerHeaders(this.provider.credential, this.provider.extraHeaders),
        timeoutMs: 20_000
      })
      const data = (await response.json()) as { data?: { id: string }[] }
      return (data.data ?? []).map((m) => ({ id: m.id })).sort((a, b) => a.id.localeCompare(b.id))
    } catch {
      return null
    }
  }
}
