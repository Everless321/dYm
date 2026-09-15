import { fetchJson, normalizeBaseUrl } from '../../http'
import type { AsrClient, AsrRequest, AsrResult, ResolvedAsrProvider } from '../types'
import { audioFormatOf, normalizeSegments, verifyRequest } from './shared'

interface TranscriptionResponse {
  text?: string
  language?: string
  segments?: unknown
}

/**
 * OpenAI 兼容 /audio/transcriptions：multipart 上传音频文件。
 * OpenAI、Groq、Mistral、硅基流动、智谱、阶跃都是这个形态，差别只在 extraForm（是否要 verbose_json 等）。
 */
export class OpenAiTranscriptionsClient implements AsrClient {
  private readonly baseUrl: string

  constructor(private readonly provider: ResolvedAsrProvider) {
    this.baseUrl = normalizeBaseUrl(provider.baseUrl, true)
  }

  private headers(): Record<string, string> {
    // 不能手写 Content-Type：multipart 的 boundary 由 fetch 生成
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (this.provider.credential.trim()) {
      headers.Authorization = `Bearer ${this.provider.credential.trim()}`
    }
    return headers
  }

  async transcribe(request: AsrRequest): Promise<AsrResult> {
    const form = new FormData()
    form.append('model', this.provider.model)
    form.append(
      'file',
      new Blob([new Uint8Array(request.audio)], { type: request.mime }),
      request.filename || `clip.${audioFormatOf(request.mime)}`
    )
    if (request.language) form.append('language', request.language)
    for (const [key, value] of Object.entries(this.provider.extraForm)) {
      form.append(key, value)
    }
    const response = await fetchJson(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
      signal: request.signal,
      timeoutMs: 180_000
    })
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('json')) {
      // response_format=text 的服务直接回纯文本
      return { text: (await response.text()).trim(), segments: [], language: null }
    }
    const data = (await response.json()) as TranscriptionResponse
    return {
      text: (data.text ?? '').trim(),
      segments: normalizeSegments(data.segments, request.durationSec),
      language: data.language ?? null
    }
  }

  async verify(): Promise<void> {
    await this.transcribe(verifyRequest())
  }
}
