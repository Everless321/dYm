import { join } from 'path'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import type { TranscriptSegment } from '../../../../shared/analysis'
import { AiHttpError } from '../types'
import { hasMp3Encoder, makeTempDir, removeTempDir, runFfmpeg } from '../ffmpeg'
import type { RateLimiter } from '../rate-limit'
import type { AnalysisWindow } from '../plan'
import type { AsrClient, AudioMime, ResolvedAsrProvider } from './types'

/**
 * 按分析窗口做语音转写：
 * 窗口 → 按提供方单次上限切成若干音频片 → ffmpeg 提取（单声道 16k mp3）→ 逐片上传 → 拼回绝对时间。
 * 纯静音的片直接跳过不上传。
 */

export interface TranscribeContext {
  client: AsrClient
  provider: ResolvedAsrProvider
  limiter: RateLimiter
  signal: AbortSignal
  language?: string
}

export interface WindowTranscript {
  window: AnalysisWindow
  /** 绝对秒 */
  segments: TranscriptSegment[]
  /** 整个窗口都没有可识别的声音 */
  silent: boolean
  language: string | null
}

/** 平均音量低于此值视为无声（dB） */
const SILENT_MEAN_DB = -50
const SILENT_MAX_DB = -35

interface Clip {
  start: number
  duration: number
  buffer: Buffer
  mime: AudioMime
  silent: boolean
}

async function extractClip(
  videoPath: string,
  start: number,
  duration: number,
  dir: string,
  index: number,
  signal: AbortSignal
): Promise<Clip> {
  const mp3 = await hasMp3Encoder()
  const ext = mp3 ? 'mp3' : 'wav'
  const out = join(dir, `clip-${index}.${ext}`)
  const codec = mp3 ? ['-c:a', 'libmp3lame', '-b:a', '48k'] : ['-c:a', 'pcm_s16le']
  const { stderr } = await runFfmpeg(
    [
      '-loglevel',
      'info',
      '-ss',
      start.toFixed(3),
      '-t',
      duration.toFixed(3),
      '-i',
      videoPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-af',
      'volumedetect',
      ...codec,
      out
    ],
    { timeoutMs: 120_000, signal }
  )
  const mean = parseFloat(/mean_volume:\s*(-?[\d.]+) dB/.exec(stderr)?.[1] ?? 'NaN')
  const max = parseFloat(/max_volume:\s*(-?[\d.]+) dB/.exec(stderr)?.[1] ?? 'NaN')
  const silent =
    (Number.isFinite(mean) && mean < SILENT_MEAN_DB) ||
    (Number.isFinite(max) && max < SILENT_MAX_DB)
  if (!existsSync(out)) throw new Error('音频提取失败：没有输出文件')
  return {
    start,
    duration,
    buffer: await readFile(out),
    mime: mp3 ? 'audio/mpeg' : 'audio/wav',
    silent
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof AiHttpError) return error.status === 429 || error.status >= 500
  const name = (error as Error)?.name
  return name === 'TimeoutError' || name === 'TypeError'
}

async function transcribeClip(
  clip: Clip,
  index: number,
  ctx: TranscribeContext
): Promise<{ segments: TranscriptSegment[]; language: string | null }> {
  for (let attempt = 0; ; attempt++) {
    await ctx.limiter.wait(ctx.signal)
    try {
      const result = await ctx.client.transcribe({
        audio: clip.buffer,
        mime: clip.mime,
        filename: `clip-${index}.${clip.mime === 'audio/wav' ? 'wav' : 'mp3'}`,
        durationSec: clip.duration,
        language: ctx.language,
        signal: ctx.signal
      })
      const segments = result.segments.length
        ? result.segments
        : result.text
          ? [{ start: 0, end: clip.duration, text: result.text }]
          : []
      return {
        segments: segments.map((s) => ({
          start: round(clip.start + s.start),
          end: round(clip.start + s.end),
          text: s.text
        })),
        language: result.language
      }
    } catch (error) {
      if (ctx.signal.aborted) throw error
      if (attempt === 0 && isRetryable(error)) {
        console.warn(`[ASR] 片段 ${index} 转写失败，重试一次：${(error as Error).message}`)
        continue
      }
      throw error
    }
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** 把窗口切成 ≤ maxClipSeconds 的片；最后一片过短（<3 秒）并入前一片 */
export function splitClips(
  window: AnalysisWindow,
  maxClipSeconds: number
): { start: number; duration: number }[] {
  const total = window.end - window.start
  const max = Math.max(10, maxClipSeconds)
  const count = Math.max(1, Math.ceil(total / max))
  const each = total / count
  return Array.from({ length: count }, (_, i) => ({
    start: round(window.start + i * each),
    duration: round(i === count - 1 ? total - i * each : each)
  }))
}

export async function transcribeWindow(
  videoPath: string,
  window: AnalysisWindow,
  ctx: TranscribeContext
): Promise<WindowTranscript> {
  const dir = await makeTempDir(`asr-${window.index}`)
  try {
    const pieces = splitClips(window, ctx.provider.maxClipSeconds)
    const segments: TranscriptSegment[] = []
    let language: string | null = null
    let anySound = false
    for (let i = 0; i < pieces.length; i++) {
      ctx.signal.throwIfAborted()
      const clip = await extractClip(
        videoPath,
        pieces[i].start,
        pieces[i].duration,
        dir,
        i,
        ctx.signal
      )
      if (clip.silent) continue
      anySound = true
      const result = await transcribeClip(clip, i, ctx)
      segments.push(...result.segments)
      language = language ?? result.language
    }
    return { window, segments, silent: !anySound, language }
  } finally {
    await removeTempDir(dir)
  }
}

/** 拼接多个窗口的字幕成一段可读文本（带时间戳，供提示词与全文检索） */
export function transcriptText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join('\n')
}
