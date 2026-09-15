import type { TranscriptSegment } from '../../../../../shared/analysis'
import type { AsrRequest } from '../types'

/**
 * 生成一段 0.6 秒 440Hz 的 16kHz 单声道 WAV，用于 verify()。
 * 用纯静音有些服务会直接报「未检测到语音」，正弦波更稳。
 */
export function toneWav(): Buffer {
  const sampleRate = 16_000
  const seconds = 0.6
  const samples = Math.floor(sampleRate * seconds)
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000)
    data.writeInt16LE(v, i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

export function verifyRequest(): AsrRequest {
  return { audio: toneWav(), mime: 'audio/wav', filename: 'probe.wav', durationSec: 0.6 }
}

export function audioFormatOf(mime: AsrRequest['mime']): 'mp3' | 'wav' {
  return mime === 'audio/wav' ? 'wav' : 'mp3'
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
  return Number.isFinite(n) ? n : null
}

/** 把各家返回的 segments 数组（start/end/text 或 start_time/end_time 等）收敛成统一结构 */
export function normalizeSegments(value: unknown, durationSec: number): TranscriptSegment[] {
  if (!Array.isArray(value)) return []
  const out: TranscriptSegment[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const text = typeof rec.text === 'string' ? rec.text.trim() : ''
    if (!text) continue
    const start = asNumber(rec.start ?? rec.start_time ?? rec.begin) ?? 0
    const end = asNumber(rec.end ?? rec.end_time) ?? durationSec
    out.push({
      start: clamp(start, 0, durationSec),
      end: clamp(Math.max(end, start), 0, durationSec),
      text
    })
  }
  return out
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}
