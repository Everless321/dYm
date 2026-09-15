import type {
  AiClient,
  AiModelInfo,
  ResolvedProvider,
  VisionRequest,
  VisionResponse
} from '../types'
import { bearerHeaders, fetchJson, normalizeBaseUrl, toDataUrl } from '../http'
import { readSseJson } from '../sse'

interface ResponsesOutputItem {
  type?: string
  content?: { type?: string; text?: string }[]
}

interface ResponsesBody {
  model?: string
  output?: ResponsesOutputItem[]
  output_text?: string
  usage?: { input_tokens?: number; output_tokens?: number }
  error?: { message?: string }
}

interface ResponsesStreamEvent {
  type?: string
  delta?: string
  response?: ResponsesBody
  error?: { message?: string }
}

export function outputTextOf(body: ResponsesBody): string {
  if (typeof body.output_text === 'string' && body.output_text) return body.output_text
  let text = ''
  for (const item of body.output ?? []) {
    if (item.type !== 'message') continue
    for (const part of item.content ?? []) {
      if (part.type === 'output_text' && part.text) text += part.text
    }
  }
  return text
}

/** 消费 Responses API 的 SSE 流，拼出正文；没有 delta 事件时从 response.completed 里兜底取 */
export async function collectResponsesStream(response: Response): Promise<VisionResponse> {
  let text = ''
  let final: ResponsesBody | undefined
  for await (const raw of readSseJson(response)) {
    const evt = raw as ResponsesStreamEvent
    switch (evt.type) {
      case 'response.output_text.delta':
        text += evt.delta ?? ''
        break
      case 'response.completed':
      case 'response.done':
        final = evt.response
        break
      case 'response.failed':
      case 'response.error':
      case 'error':
        throw new Error(
          `模型返回错误：${evt.error?.message ?? evt.response?.error?.message ?? '未知错误'}`
        )
      default:
        break
    }
  }
  if (!text && final) text = outputTextOf(final)
  return {
    text,
    model: final?.model,
    usage: final?.usage
      ? { input: final.usage.input_tokens, output: final.usage.output_tokens }
      : undefined
  }
}

export interface ResponsesClientOptions {
  /** 额外请求头（Codex 需要 account id / originator） */
  headers?: () => Promise<Record<string, string>> | Record<string, string>
  /** Codex 后端只接受流式，且拒绝 temperature / max_output_tokens */
  codexMode?: boolean
}

export function buildResponsesInput(request: VisionRequest): unknown[] {
  return [
    {
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: request.prompt },
        ...request.images.map((img) => ({
          type: 'input_image',
          image_url: toDataUrl(img.mime, img.data),
          detail: 'auto'
        }))
      ]
    }
  ]
}

export class OpenAiResponsesClient implements AiClient {
  private readonly baseUrl: string

  constructor(
    private readonly provider: ResolvedProvider,
    private readonly options: ResponsesClientOptions = {}
  ) {
    this.baseUrl = normalizeBaseUrl(provider.baseUrl, !options.codexMode)
  }

  private async headers(): Promise<Record<string, string>> {
    const extra = this.options.headers ? await this.options.headers() : {}
    return bearerHeaders(this.provider.credential, { ...this.provider.extraHeaders, ...extra })
  }

  private buildBody(request: VisionRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.provider.model,
      instructions: request.system,
      input: buildResponsesInput(request),
      stream,
      store: false
    }
    if (this.provider.reasoningEffort && this.provider.reasoningEffort !== 'none') {
      body.reasoning = { effort: this.provider.reasoningEffort }
    }
    if (this.options.codexMode) {
      body.parallel_tool_calls = false
      body.tool_choice = 'none'
      body.tools = []
      body.include = []
    } else {
      body.max_output_tokens = request.maxOutputTokens ?? 1024
      if (request.json) body.text = { format: { type: 'json_object' } }
    }
    return body
  }

  async complete(request: VisionRequest): Promise<VisionResponse> {
    // 统一走流式：Codex 强制要求，官方接口流式也能避免长时间无字节导致的中间层超时
    const response = await fetchJson(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: { ...(await this.headers()), Accept: 'text/event-stream' },
      body: JSON.stringify(this.buildBody(request, true)),
      signal: request.signal
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream')) {
      // 某些兼容网关忽略 stream 直接回 JSON
      const body = (await response.json()) as ResponsesBody
      if (body.error?.message) throw new Error(`模型返回错误：${body.error.message}`)
      return {
        text: outputTextOf(body),
        model: body.model,
        usage: body.usage
          ? { input: body.usage.input_tokens, output: body.usage.output_tokens }
          : undefined
      }
    }
    return collectResponsesStream(response)
  }

  async verify(): Promise<void> {
    const result = await this.complete({
      system: 'Reply with the single word OK.',
      prompt: 'Hi',
      images: [],
      signal: AbortSignal.timeout(30_000)
    })
    if (!result.text.trim()) throw new Error('模型没有返回内容')
  }

  async listModels(): Promise<AiModelInfo[] | null> {
    if (this.options.codexMode) return null
    try {
      const response = await fetchJson(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: await this.headers(),
        timeoutMs: 20_000
      })
      const data = (await response.json()) as { data?: { id: string }[] }
      return (data.data ?? []).map((m) => ({ id: m.id })).sort((a, b) => a.id.localeCompare(b.id))
    } catch {
      return null
    }
  }
}
