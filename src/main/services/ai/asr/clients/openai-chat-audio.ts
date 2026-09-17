import { bearerHeaders, fetchJson, normalizeBaseUrl, toDataUrl } from '../../http'
import type { AsrClient, AsrRequest, AsrResult, ResolvedAsrProvider } from '../types'
import { audioFormatOf, verifyRequest } from './shared'

interface ChatResponse {
  choices?: { message?: { content?: string | { text?: string }[] } }[]
}

const TRANSCRIBE_INSTRUCTION =
  '逐字转写这段音频里的语音，保留原语言，不要翻译、不要总结、不要加任何说明；没有语音就输出空字符串。'

/**
 * 通过 /chat/completions 的 input_audio 内容块做转写。
 * 阿里百炼的 qwen3-asr-flash 只走这个形态（data 为 Data URL，附 asr_options）；
 * OpenAI 的音频对话模型则要 base64 + format 两个字段并需要文字指令。按地址区分。
 */
export class OpenAiChatAudioClient implements AsrClient {
  private readonly baseUrl: string
  private readonly dashscope: boolean

  constructor(private readonly provider: ResolvedAsrProvider) {
    this.baseUrl = normalizeBaseUrl(provider.baseUrl, true)
    this.dashscope = /dashscope|aliyuncs\.com/i.test(provider.baseUrl)
  }

  async transcribe(request: AsrRequest): Promise<AsrResult> {
    const content: unknown[] = []
    if (this.dashscope) {
      content.push({
        type: 'input_audio',
        input_audio: { data: toDataUrl(request.mime, request.audio) }
      })
    } else {
      content.push({ type: 'text', text: TRANSCRIBE_INSTRUCTION })
      content.push({
        type: 'input_audio',
        input_audio: {
          data: request.audio.toString('base64'),
          format: audioFormatOf(request.mime)
        }
      })
    }
    const body: Record<string, unknown> = {
      model: this.provider.model,
      messages: [{ role: 'user', content }],
      stream: false
    }
    if (this.dashscope) {
      body.asr_options = {
        enable_itn: true,
        ...(request.language ? { language: request.language } : {})
      }
    } else {
      body.modalities = ['text']
    }
    const response = await fetchJson(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: bearerHeaders(this.provider.credential),
      body: JSON.stringify(body),
      signal: request.signal,
      timeoutMs: 180_000
    })
    const data = (await response.json()) as ChatResponse
    const raw = data.choices?.[0]?.message?.content
    const text = Array.isArray(raw)
      ? raw.map((part) => part.text ?? '').join('')
      : typeof raw === 'string'
        ? raw
        : ''
    return { text: text.trim(), segments: [], language: request.language ?? null }
  }

  async verify(): Promise<void> {
    await this.transcribe(verifyRequest())
  }
}
