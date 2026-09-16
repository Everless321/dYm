import { fetchJson, normalizeBaseUrl } from '../../http'
import { extractJsonObject } from '../../json'
import type { AsrClient, AsrRequest, AsrResult, ResolvedAsrProvider } from '../types'
import { normalizeSegments, verifyRequest } from './shared'

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[]
}

const PROMPT = `逐字转写这段音频里的语音，保留原语言，不要翻译、不要总结。
只输出一个 JSON 对象：{"language":"zh","segments":[{"start":0.0,"end":3.2,"text":"……"}]}
- start / end 是相对这段音频开头的秒数，按语义分句，每句不超过 20 秒
- 只有背景音乐、没有人声时 segments 给空数组`

/** Gemini generateContent 内联音频做转写，顺带让它按句给时间戳 */
export class GeminiAudioClient implements AsrClient {
  private readonly baseUrl: string

  constructor(private readonly provider: ResolvedAsrProvider) {
    this.baseUrl = normalizeBaseUrl(provider.baseUrl).replace(/\/v1(beta)?$/, '')
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.provider.credential.trim()) headers['x-goog-api-key'] = this.provider.credential.trim()
    return headers
  }

  async transcribe(request: AsrRequest): Promise<AsrResult> {
    const url = `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.provider.model)}:generateContent`
    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: `${PROMPT}\n音频时长约 ${Math.round(request.durationSec)} 秒。` },
            { inlineData: { mimeType: request.mime, data: request.audio.toString('base64') } }
          ]
        }
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
      }
    }
    const response = await fetchJson(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: request.signal,
      timeoutMs: 180_000
    })
    const data = (await response.json()) as GeminiResponse
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    const obj = extractJsonObject(text)
    if (!obj) return { text: text.trim(), segments: [], language: null }
    const segments = normalizeSegments(obj.segments, request.durationSec)
    return {
      text: segments.map((s) => s.text).join(' ') || (typeof obj.text === 'string' ? obj.text : ''),
      segments,
      language: typeof obj.language === 'string' ? obj.language : null
    }
  }

  async verify(): Promise<void> {
    await this.transcribe(verifyRequest())
  }
}
