import {
  getPostById,
  getPostTranscript,
  savePostAnalysisV2,
  savePostMediaInfo,
  savePostTranscript,
  type DbPost
} from '../../database'
import type {
  AnalysisRunMeta,
  AnalysisStage,
  TranscriptSegment,
  VideoAnalysis
} from '../../../shared/analysis'
import { emitPostAnalyzed } from '../scripts/emit'
import { AiHttpError, type AiClient, type VisionImage, type VisionRequest } from './types'
import type { RateLimiter } from './rate-limit'
import { probeMedia } from './ffmpeg'
import { planAnalysis, type AnalysisPlan, type AnalysisWindow, type PlanOptions } from './plan'
import { extractWindowFrames, findVideoFile, loadGalleryImages, type FrameSet } from './frames'
import {
  transcribeWindow,
  transcriptText,
  type AsrClient,
  type ResolvedAsrProvider,
  type WindowTranscript
} from './asr'
import {
  PROMPT_VERSION,
  buildReduceMessage,
  buildSegmentMessage,
  buildSingleMessage,
  formatTime
} from './prompt'
import { parseSegmentUnderstanding, parseVideoAnalysis, type SegmentUnderstanding } from './schema'

/**
 * 单条作品的完整分析流程：
 * 探测 → 分段规划 → （每段）转写 + 抽帧 + 分段理解 → 汇总 → 落库。
 * 短视频 / 图集只有一段，跳过汇总直接出整片结果。
 */

export interface PipelineOptions {
  client: AiClient
  limiter: RateLimiter
  /** 模型名，写入 analysis_model */
  model: string
  asr: { client: AsrClient; provider: ResolvedAsrProvider; limiter: RateLimiter } | null
  prompts: { single: string; segment: string; reduce: string }
  plan: PlanOptions
  tagMode: 'open' | 'closed'
  signal: AbortSignal
  onStage?: (stage: AnalysisStage, detail?: string) => void
}

export interface PipelineResult {
  analysis: VideoAnalysis
  keptTags: string[]
  meta: AnalysisRunMeta
}

function isRetryable(error: unknown): boolean {
  if (error instanceof AiHttpError) return error.status === 429 || error.status >= 500
  const name = (error as Error)?.name
  return name === 'TimeoutError' || name === 'TypeError'
}

class Usage {
  input = 0
  output = 0
  add(usage?: { input?: number; output?: number }): void {
    this.input += usage?.input ?? 0
    this.output += usage?.output ?? 0
  }
}

async function complete(
  request: Omit<VisionRequest, 'signal'>,
  options: PipelineOptions,
  usage: Usage,
  label: string
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    await options.limiter.wait(options.signal)
    try {
      const response = await options.client.complete({ ...request, signal: options.signal })
      usage.add(response.usage)
      return response.text
    } catch (error) {
      if (options.signal.aborted) throw error
      if (attempt === 0 && isRetryable(error)) {
        console.warn(`[AI] ${label} 请求失败，重试一次：${(error as Error).message}`)
        continue
      }
      throw error
    }
  }
}

function engineOf(provider: ResolvedAsrProvider): string {
  return `${provider.protocol}:${provider.model}`
}

function covers(coverage: { start: number; end: number }[], window: AnalysisWindow): boolean {
  return coverage.some((c) => c.start <= window.start + 0.5 && c.end >= window.end - 0.5)
}

interface WindowResult {
  window: AnalysisWindow
  frames: FrameSet
  transcript: WindowTranscript | null
  /** 这一段转写失败（已降级为只看画面）的原因 */
  asrError: string | null
}

/** 密钥错误 / 无权限是配置问题，继续跑下去每条都会失败，直接让条目失败提醒用户 */
function isAsrConfigError(error: unknown): boolean {
  return error instanceof AiHttpError && (error.status === 401 || error.status === 403)
}

/** 一段的素材：转写（可复用上次结果）+ 抽帧 */
async function gatherWindow(
  videoPath: string,
  window: AnalysisWindow,
  plan: AnalysisPlan,
  options: PipelineOptions,
  reusable: {
    engine: string
    coverage: { start: number; end: number }[]
    segments: TranscriptSegment[]
  } | null,
  progress: string
): Promise<WindowResult> {
  let transcript: WindowTranscript | null = null
  let asrError: string | null = null
  if (options.asr) {
    options.onStage?.('transcribe', progress)
    if (
      reusable &&
      reusable.engine === engineOf(options.asr.provider) &&
      covers(reusable.coverage, window)
    ) {
      const segments = reusable.segments.filter(
        (s) => s.start >= window.start - 0.5 && s.start < window.end
      )
      transcript = { window, segments, silent: false, language: null }
    } else {
      try {
        transcript = await transcribeWindow(videoPath, window, {
          client: options.asr.client,
          provider: options.asr.provider,
          limiter: options.asr.limiter,
          signal: options.signal
        })
      } catch (error) {
        if (options.signal.aborted || isAsrConfigError(error)) throw error
        // 转写是锦上添花：服务抖动 / 音频格式不支持时退化为只看画面，不让整条分析失败
        asrError = (error as Error).message || String(error)
        console.warn(`[ASR] 第 ${window.index + 1} 段转写失败，改为仅画面分析：${asrError}`)
      }
    }
  }
  options.onStage?.('frames', progress)
  const frames = await extractWindowFrames(videoPath, window, {
    maxFrames: plan.framesPerWindow,
    mosaic: plan.mosaic,
    signal: options.signal
  })
  return { window, frames, transcript, asrError }
}

export async function analyzePost(post: DbPost, options: PipelineOptions): Promise<PipelineResult> {
  const startedAt = Date.now()
  const usage = new Usage()
  const postContext = {
    desc: post.desc,
    caption: post.caption,
    aweme_type: post.aweme_type,
    nickname: post.nickname,
    create_time: post.create_time
  }

  // ---- 图集：没有时间轴，直接单次理解 ----
  if (post.aweme_type === 68) {
    options.onStage?.('frames')
    const images = await loadGalleryImages(post, options.plan.framesShort)
    options.signal.throwIfAborted()
    options.onStage?.('segment')
    const text = await complete(
      {
        system: options.prompts.single,
        prompt: buildSingleMessage({
          post: postContext,
          duration: null,
          times: [],
          mosaic: false,
          imageCount: images.length,
          transcript: [],
          transcribed: false,
          silent: false
        }),
        images,
        json: true,
        maxOutputTokens: 4096
      },
      options,
      usage,
      `作品 ${post.aweme_id}`
    )
    const analysis = parseVideoAnalysis(text, 0)
    analysis.flags.noSpeech = true
    return persist(post, analysis, options, {
      asrEngine: null,
      asrError: null,
      duration: 0,
      analyzedSeconds: 0,
      segmentCount: 1,
      frameCount: images.length,
      usage,
      startedAt
    })
  }

  // ---- 视频 ----
  options.onStage?.('probe')
  const videoPath = findVideoFile(post)
  const info = await probeMedia(videoPath)
  savePostMediaInfo(post.id, info)
  const plan = planAnalysis(info.duration, options.plan)
  options.signal.throwIfAborted()

  const asrActive = options.asr && info.hasAudio ? options.asr : null
  const effective: PipelineOptions = { ...options, asr: asrActive }
  const existing = asrActive ? getPostTranscript(post.id) : null
  const reusable = existing
    ? { engine: existing.engine, coverage: existing.coverage, segments: existing.segments }
    : null

  const single = plan.windows.length === 1
  const results: WindowResult[] = []
  const understandings: SegmentUnderstanding[] = []
  let frameCount = 0

  for (const window of plan.windows) {
    const progress = `${window.index + 1}/${plan.windows.length}`
    const result = await gatherWindow(videoPath, window, plan, effective, reusable, progress)
    results.push(result)
    frameCount += result.frames.times.length
    options.signal.throwIfAborted()
    if (single) break

    options.onStage?.('segment', progress)
    const text = await complete(
      {
        system: options.prompts.segment,
        prompt: buildSegmentMessage({
          post: postContext,
          duration: info.duration,
          window,
          totalWindows: plan.windows.length,
          times: result.frames.times,
          mosaic: result.frames.mosaic,
          imageCount: result.frames.images.length,
          transcript: result.transcript?.segments ?? [],
          transcribed: !!result.transcript,
          silent: result.transcript?.silent ?? false
        }),
        images: result.frames.images,
        json: true,
        maxOutputTokens: 2048
      },
      options,
      usage,
      `作品 ${post.aweme_id} 第 ${window.index + 1} 段`
    )
    understandings.push(parseSegmentUnderstanding(text, window))
  }

  // 字幕先落库：后面汇总失败了，重试时转写可以复用
  const allSegments = results
    .flatMap((r) => r.transcript?.segments ?? [])
    .sort((a, b) => a.start - b.start)
  const anySpeech = allSegments.length > 0
  const transcribedResults = results.filter((r) => r.transcript)
  const allSilent = transcribedResults.every((r) => r.transcript!.silent)
  const asrErrors = results.map((r) => r.asrError).filter((e): e is string => !!e)
  // 转写只在至少一段成功时落库；coverage 只记成功的段，失败的段重试时会再转
  if (asrActive && transcribedResults.length) {
    const language = transcribedResults.find((r) => r.transcript!.language)?.transcript!.language
    savePostTranscript({
      postId: post.id,
      engine: engineOf(asrActive.provider),
      language: language ?? existing?.language ?? null,
      partial: plan.partial || transcribedResults.length < results.length,
      coverage: transcribedResults.map((r) => ({ start: r.window.start, end: r.window.end })),
      segments: allSegments,
      text: transcriptText(allSegments)
    })
  }

  let analysis: VideoAnalysis
  if (single) {
    const only = results[0]
    options.onStage?.('segment')
    const text = await complete(
      {
        system: options.prompts.single,
        prompt: buildSingleMessage({
          post: postContext,
          duration: info.duration,
          times: only.frames.times,
          mosaic: only.frames.mosaic,
          imageCount: only.frames.images.length,
          transcript: allSegments,
          transcribed: !!only.transcript,
          silent: only.transcript?.silent ?? false
        }),
        images: only.frames.images,
        json: true,
        maxOutputTokens: 4096
      },
      options,
      usage,
      `作品 ${post.aweme_id}`
    )
    analysis = parseVideoAnalysis(text, info.duration)
  } else {
    options.onStage?.('reduce')
    const text = await complete(
      {
        system: options.prompts.reduce,
        prompt: buildReduceMessage({
          post: postContext,
          duration: info.duration,
          partial: plan.partial,
          segments: understandings,
          anySpeech
        }),
        images: [],
        json: true,
        maxOutputTokens: 4096
      },
      options,
      usage,
      `作品 ${post.aweme_id} 汇总`
    )
    analysis = parseVideoAnalysis(text, info.duration)
    if (!analysis.chapters.length) {
      // 模型没给章节就用分段结果兜底，至少能按段跳转
      analysis.chapters = understandings.map((u) => ({
        start: u.start,
        end: u.end,
        title: u.scene || u.summary.slice(0, 20),
        summary: u.summary,
        tags: u.tags.slice(0, 6)
      }))
    }
    if (!analysis.content) {
      // 汇总步骤没写 content 就把各段内容按时间拼起来，总比没有强
      analysis.content = understandings
        .filter((u) => u.content || u.summary)
        .map((u) => `[${formatTime(u.start)}-${formatTime(u.end)}] ${u.content || u.summary}`)
        .join('\n')
    }
  }
  // 转写过且没听到人声才敢说「无口播」；全部段都转写失败时不下结论
  if (transcribedResults.length && (allSilent || !anySpeech)) analysis.flags.noSpeech = true
  if (!info.hasAudio) analysis.flags.noSpeech = true

  return persist(post, analysis, options, {
    asrEngine: asrActive ? engineOf(asrActive.provider) : null,
    asrError: asrErrors.length
      ? `${asrErrors.length}/${results.length} 段转写失败：${asrErrors[0]}`
      : null,
    duration: info.duration,
    analyzedSeconds: plan.analyzedSeconds,
    segmentCount: plan.windows.length,
    frameCount,
    usage,
    startedAt
  })
}

function persist(
  post: DbPost,
  analysis: VideoAnalysis,
  options: PipelineOptions,
  info: {
    asrEngine: string | null
    asrError: string | null
    duration: number
    analyzedSeconds: number
    segmentCount: number
    frameCount: number
    usage: Usage
    startedAt: number
  }
): PipelineResult {
  options.signal.throwIfAborted()
  options.onStage?.('save')
  const meta: AnalysisRunMeta = {
    model: options.model,
    asrEngine: info.asrEngine,
    asrError: info.asrError,
    promptVersion: PROMPT_VERSION,
    duration: info.duration,
    analyzedSeconds: info.analyzedSeconds,
    segmentCount: info.segmentCount,
    frameCount: info.frameCount,
    tokensIn: info.usage.input,
    tokensOut: info.usage.output,
    elapsedMs: Date.now() - info.startedAt
  }
  const keptTags = savePostAnalysisV2(post.id, analysis, meta, {
    tagMode: options.tagMode,
    raw: JSON.stringify(analysis)
  })
  const updated = getPostById(post.id)
  if (updated) emitPostAnalyzed(updated)
  return { analysis, keptTags, meta }
}

export type { VisionImage }
