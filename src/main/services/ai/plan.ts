import type { AnalysisMosaicMode } from '../../../shared/ai'

/**
 * 分段规划：把一条视频切成若干「分析窗口」。
 * - ≤ 60 秒：一段吃整片，走单次理解
 * - 更长：按 segmentSeconds 切段，段数超过预算（maxMinutes）时在全片范围内均匀抽样，
 *   开头结尾必取，保证长视频也能覆盖到「讲了什么 / 怎么结束」
 * - 超过 skipOverMinutes 直接拒绝
 */

export interface AnalysisWindow {
  index: number
  start: number
  end: number
}

export interface AnalysisPlan {
  duration: number
  windows: AnalysisWindow[]
  /** 单段短视频（整片一次理解，不走 map-reduce） */
  single: boolean
  /** 是否只覆盖了部分时长（长视频抽样） */
  partial: boolean
  /** 实际分析覆盖秒数 */
  analyzedSeconds: number
  /** 每段送多少帧 */
  framesPerWindow: number
  /** 是否把每段的帧拼成一张图 */
  mosaic: boolean
}

export interface PlanOptions {
  segmentSeconds: number
  maxMinutes: number
  skipOverMinutes: number
  framesShort: number
  framesPerSegment: number
  mosaic: AnalysisMosaicMode
}

export const SHORT_VIDEO_SECONDS = 60

export class VideoTooLongError extends Error {
  constructor(duration: number, limitMinutes: number) {
    super(
      `视频时长 ${Math.round(duration / 60)} 分钟，超过分析上限 ${limitMinutes} 分钟，已跳过（可在分析设置里调整）`
    )
    this.name = 'VideoTooLongError'
  }
}

export function planAnalysis(duration: number, options: PlanOptions): AnalysisPlan {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长')
  if (duration > options.skipOverMinutes * 60) {
    throw new VideoTooLongError(duration, options.skipOverMinutes)
  }

  if (duration <= SHORT_VIDEO_SECONDS) {
    // 短视频每 2 秒最多一帧：5 秒的视频抽 16 帧全是重复画面
    const frames = Math.max(1, Math.min(options.framesShort, Math.ceil(duration / 2)))
    return {
      duration,
      windows: [{ index: 0, start: 0, end: duration }],
      single: true,
      partial: false,
      analyzedSeconds: duration,
      framesPerWindow: frames,
      mosaic: false
    }
  }

  const segment = Math.max(30, options.segmentSeconds)
  const total = Math.ceil(duration / segment)
  const budget = Math.max(1, Math.floor((options.maxMinutes * 60) / segment))
  const picked = total <= budget ? range(total) : sampleEvenly(total, budget)
  const windows = picked.map((i, index) => ({
    index,
    start: i * segment,
    end: Math.min(duration, (i + 1) * segment)
  }))
  const analyzedSeconds = windows.reduce((sum, w) => sum + (w.end - w.start), 0)
  const mosaic = options.mosaic === 'on' || (options.mosaic === 'auto' && duration > 10 * 60)
  return {
    duration,
    windows,
    single: false,
    partial: picked.length < total,
    analyzedSeconds,
    framesPerWindow: Math.max(1, options.framesPerSegment),
    mosaic
  }
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

/** 从 0..total-1 里均匀取 count 个，首尾必含 */
export function sampleEvenly(total: number, count: number): number[] {
  if (count >= total) return range(total)
  if (count === 1) return [0]
  const picked = new Set<number>()
  for (let k = 0; k < count; k++) {
    picked.add(Math.round((k * (total - 1)) / (count - 1)))
  }
  // 取整可能撞车，补齐到 count 个
  for (let i = 0; picked.size < count && i < total; i++) picked.add(i)
  return Array.from(picked).sort((a, b) => a - b)
}
