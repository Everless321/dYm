import { BrowserWindow } from 'electron'
import {
  activeJobPostIds,
  claimPendingItems,
  deleteAnalysisJob,
  finishItem,
  getAnalysisJob,
  getDatabase,
  getPostById,
  getSetting,
  getUnanalyzedPosts,
  insertAnalysisJob,
  listAnalysisJobs,
  listJobItems,
  nextQueuedJob,
  parseJobOptions,
  postTitle,
  pruneFinishedJobs,
  recountJob,
  releaseRunningItems,
  requeueFailedItems,
  setSetting,
  toJobView,
  updateJobStatus,
  type AnalysisJobRow
} from '../../database'
import {
  ANALYSIS_DEFAULTS,
  type AnalysisJobItemStatus,
  type AnalysisJobItemView,
  type AnalysisJobView,
  type AnalysisQueueEvent,
  type AnalysisSettings,
  type CreateAnalysisJobInput
} from '../../../shared/ai'
import { appEvents } from '../app-events'
import { createClientFor, getProviderView, resolveProvider } from './providers'
import { RateLimiter } from './rate-limit'
import { analyzePost, type PipelineOptions } from './pipeline'
import {
  buildReducePrompt,
  buildSegmentPrompt,
  buildSinglePrompt,
  getAnalysisPrompt
} from './prompt'
import { createAsrClient, getDefaultAsrProviderId, resolveAsrProvider } from './asr'
import { ANALYSIS_STAGE_LABELS, type AnalysisStage } from '../../../shared/analysis'

const QUEUE_CHANNEL = 'analysis:queue'
const BROADCAST_THROTTLE_MS = 150

// ==================== 设置 ====================

function intSetting(key: string, fallback: number): number {
  return Math.max(1, parseInt(getSetting(key) || '') || fallback)
}

export function getAnalysisSettings(): AnalysisSettings {
  const d = ANALYSIS_DEFAULTS
  const mosaic = getSetting('analysis_mosaic')
  return {
    prompt: getAnalysisPrompt(),
    framesShort: intSetting('analysis_frames_short', d.framesShort),
    framesPerSegment: intSetting('analysis_frames_per_segment', d.framesPerSegment),
    segmentSeconds: intSetting('analysis_segment_seconds', d.segmentSeconds),
    maxMinutes: intSetting('analysis_max_minutes', d.maxMinutes),
    skipOverMinutes: intSetting('analysis_skip_over_minutes', d.skipOverMinutes),
    mosaic: mosaic === 'on' || mosaic === 'off' ? mosaic : 'auto',
    transcribe: (getSetting('analysis_transcribe') ?? 'true') !== 'false',
    asrRpm: intSetting('analysis_asr_rpm', d.asrRpm),
    concurrency: intSetting('analysis_concurrency', d.concurrency),
    rpm: intSetting('analysis_rpm', d.rpm),
    tagMode: getSetting('analysis_tag_mode') === 'closed' ? 'closed' : 'open',
    autoAnalyze: getSetting('analysis_auto') === 'true'
  }
}

function clampInt(value: unknown, min: number, max: number, field: string): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${field} 必须是 ${min}-${max} 之间的整数`)
  }
  return Math.trunc(n)
}

/** 校验并写入分析设置；只更新传入的字段。空提示词表示恢复默认 */
export function saveAnalysisSettings(patch: Partial<AnalysisSettings>): AnalysisSettings {
  const ints: [keyof AnalysisSettings, string, number, number, string][] = [
    ['framesShort', 'analysis_frames_short', 1, 30, '短视频帧数'],
    ['framesPerSegment', 'analysis_frames_per_segment', 1, 16, '每段帧数'],
    ['segmentSeconds', 'analysis_segment_seconds', 30, 300, '分段长度'],
    ['maxMinutes', 'analysis_max_minutes', 1, 240, '最多分析分钟数'],
    ['skipOverMinutes', 'analysis_skip_over_minutes', 1, 1440, '跳过阈值'],
    ['asrRpm', 'analysis_asr_rpm', 1, 600, '转写每分钟请求数'],
    ['concurrency', 'analysis_concurrency', 1, 16, '并发数'],
    ['rpm', 'analysis_rpm', 1, 600, '每分钟请求数']
  ]
  if (patch.prompt !== undefined) setSetting('analysis_prompt', String(patch.prompt).trim())
  for (const [field, key, min, max, label] of ints) {
    if (patch[field] !== undefined) setSetting(key, String(clampInt(patch[field], min, max, label)))
  }
  if (patch.maxMinutes !== undefined || patch.skipOverMinutes !== undefined) {
    const next = getAnalysisSettings()
    if (next.skipOverMinutes < next.maxMinutes) {
      setSetting('analysis_skip_over_minutes', String(next.maxMinutes))
    }
  }
  if (patch.mosaic !== undefined) {
    setSetting(
      'analysis_mosaic',
      patch.mosaic === 'on' || patch.mosaic === 'off' ? patch.mosaic : 'auto'
    )
  }
  if (patch.transcribe !== undefined) {
    setSetting('analysis_transcribe', patch.transcribe ? 'true' : 'false')
  }
  if (patch.tagMode !== undefined) {
    setSetting('analysis_tag_mode', patch.tagMode === 'closed' ? 'closed' : 'open')
  }
  if (patch.autoAnalyze !== undefined) {
    setSetting('analysis_auto', patch.autoAnalyze ? 'true' : 'false')
  }
  return getAnalysisSettings()
}

// ==================== 队列状态 ====================

/** 打断当前作业的意图：shutdown 与 pause 的区别是收尾后回到 queued，下次启动自动续跑 */
type RunIntent = 'pause' | 'cancel' | 'shutdown' | null

interface ActiveRun {
  jobId: number
  controller: AbortController
  intent: RunIntent
  current: Map<number, string>
}

let loopRunning = false
let active: ActiveRun | null = null
/** 应用退出中：不再起新作业、不再向窗口推送（库随时会关） */
let stopping = false
/** 自动分析合批缓冲 */
let autoPending = new Set<number>()
let autoTimer: NodeJS.Timeout | null = null
/** 一个提供方一个限流器：两个作业先后用同一个 Key 时，RPM 窗口应该连续 */
const limiters = new Map<string, RateLimiter>()

function limiterFor(providerId: string, rpm: number): RateLimiter {
  let limiter = limiters.get(providerId)
  if (!limiter) {
    limiter = new RateLimiter(rpm)
    limiters.set(providerId, limiter)
  } else {
    limiter.setRpm(rpm)
  }
  return limiter
}

// ==================== 广播 ====================

let broadcastTimer: NodeJS.Timeout | null = null
let pendingItemDone: AnalysisQueueEvent['itemDone'] | undefined

function sendToWindows(payload: AnalysisQueueEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(QUEUE_CHANNEL, payload)
  }
}

function flushBroadcast(): void {
  broadcastTimer = null
  if (stopping) return
  const payload: AnalysisQueueEvent = { jobs: listJobs() }
  if (pendingItemDone) {
    payload.itemDone = pendingItemDone
    pendingItemDone = undefined
  }
  sendToWindows(payload)
}

/** 作业列表快照节流推送；带 itemDone 的事件立即发（对话框要逐条更新） */
function broadcast(itemDone?: AnalysisQueueEvent['itemDone']): void {
  if (stopping) return
  if (itemDone) {
    if (broadcastTimer) {
      clearTimeout(broadcastTimer)
      broadcastTimer = null
    }
    sendToWindows({ jobs: listJobs(), itemDone })
    return
  }
  if (broadcastTimer) return
  broadcastTimer = setTimeout(flushBroadcast, BROADCAST_THROTTLE_MS)
}

// ==================== 查询 ====================

function viewOf(row: AnalysisJobRow): AnalysisJobView {
  const providerName = row.provider_id ? (getProviderView(row.provider_id)?.name ?? null) : null
  const current = active?.jobId === row.id ? Array.from(active.current.values()).slice(0, 3) : []
  return toJobView(row, { providerName, current })
}

export function listJobs(): AnalysisJobView[] {
  return listAnalysisJobs().map(viewOf)
}

export function getJob(id: number): AnalysisJobView | null {
  const row = getAnalysisJob(id)
  return row ? viewOf(row) : null
}

export function getJobItems(
  id: number,
  filter: { status?: AnalysisJobItemStatus; page?: number; pageSize?: number } = {}
): { items: AnalysisJobItemView[]; total: number } {
  return listJobItems(id, filter)
}

export function isQueueBusy(): boolean {
  return active !== null
}

// ==================== 创建 ====================

function selectPostIds(input: CreateAnalysisJobInput): number[] {
  if (input.postIds?.length) {
    return Array.from(new Set(input.postIds.filter((id) => Number.isInteger(id) && id > 0)))
  }
  const onlyUnanalyzed = input.onlyUnanalyzed !== false
  if (onlyUnanalyzed) return getUnanalyzedPosts(input.secUid).map((p) => p.id)
  const rows = getDatabase()
    .prepare(
      `SELECT id FROM posts ${input.secUid ? 'WHERE sec_uid = ?' : ''} ORDER BY downloaded_at DESC`
    )
    .all(...(input.secUid ? [input.secUid] : [])) as { id: number }[]
  return rows.map((r) => r.id)
}

function defaultJobName(input: CreateAnalysisJobInput, count: number): string {
  if (input.kind === 'reanalyze')
    return count === 1 ? '重新分析 1 条作品' : `重新分析 ${count} 条作品`
  if (input.kind === 'auto') return `自动分析 ${count} 条新作品`
  if (input.secUid) {
    const user = getDatabase()
      .prepare('SELECT nickname FROM users WHERE sec_uid = ?')
      .get(input.secUid) as { nickname: string } | undefined
    return `分析 ${user?.nickname ?? input.secUid}（${count} 条）`
  }
  return input.postIds?.length ? `分析 ${count} 条作品` : `分析全部未分析作品（${count} 条）`
}

export function createJob(input: CreateAnalysisJobInput): AnalysisJobView {
  // 先校验提供方，错在这里比排进队列后才失败友好
  const provider = resolveProvider(input.providerId ?? null)
  let postIds = selectPostIds(input)
  if (input.kind === 'auto') {
    // 自动入队不该把还在别的作业里排队的作品再排一遍
    const busy = activeJobPostIds(postIds)
    postIds = postIds.filter((id) => !busy.has(id))
  }
  if (!postIds.length) throw new Error('没有需要分析的作品')

  const settings = getAnalysisSettings()
  // 转写提供方在建作业时就定下来：中途改设置不影响已排队的作业
  const asrProviderId = settings.transcribe
    ? (input.asrProviderId ?? getDefaultAsrProviderId())
    : null
  if (asrProviderId) resolveAsrProvider(asrProviderId)
  const { prompt, autoAnalyze: _auto, ...rest } = settings
  void _auto
  const row = insertAnalysisJob({
    name: input.name?.trim() || defaultJobName(input, postIds.length),
    kind: input.kind ?? 'analyze',
    providerId: provider.id,
    prompt,
    options: { ...rest, asrProviderId },
    postIds,
    priority: !!input.priority
  })
  console.log(`[AI] 新建分析作业 #${row.id}「${row.name}」，${row.total} 条`)
  broadcast()
  kick()
  return viewOf(row)
}

// ==================== 控制 ====================

export function pauseJob(id: number): void {
  const row = getAnalysisJob(id)
  if (!row) throw new Error('作业不存在')
  if (active?.jobId === id) {
    // 已经在取消 / 退出收尾的作业不能被降级成暂停
    if (active.intent === null) active.intent = 'pause'
    active.controller.abort(new Error('paused'))
    return
  }
  if (row.status === 'queued') {
    updateJobStatus(id, 'paused')
    broadcast()
  }
}

export function resumeJob(id: number): void {
  const row = getAnalysisJob(id)
  if (!row) throw new Error('作业不存在')
  if (row.status !== 'paused') return
  updateJobStatus(id, 'queued')
  broadcast()
  kick()
}

export function cancelJob(id: number): void {
  const row = getAnalysisJob(id)
  if (!row) throw new Error('作业不存在')
  if (active?.jobId === id) {
    active.intent = 'cancel'
    active.controller.abort(new Error('cancelled'))
    return
  }
  if (row.status === 'queued' || row.status === 'paused') {
    releaseRunningItems(id)
    updateJobStatus(id, 'cancelled', { finished: true })
    broadcast()
  }
}

export function retryFailed(id: number): number {
  const row = getAnalysisJob(id)
  if (!row) throw new Error('作业不存在')
  const count = requeueFailedItems(id)
  if (count > 0 && row.status !== 'running') {
    updateJobStatus(id, 'queued')
    broadcast()
    kick()
  }
  return count
}

export async function deleteJob(id: number): Promise<void> {
  if (active?.jobId === id) {
    cancelJob(id)
    // 等当前作业退出循环，否则 worker 还会往已删除的作业写条目
    await waitForActiveToEnd(id)
  }
  deleteAnalysisJob(id)
  broadcast()
}

function waitForActiveToEnd(jobId: number): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (active?.jobId !== jobId) return resolve()
      setTimeout(check, 100)
    }
    check()
  })
}

/** 停掉一切并等待退出，应用退出前调用；未完成的作业留在库里，下次启动续跑 */
export async function shutdownQueue(): Promise<void> {
  stopping = true
  if (broadcastTimer) {
    clearTimeout(broadcastTimer)
    broadcastTimer = null
  }
  if (autoTimer) {
    clearTimeout(autoTimer)
    autoTimer = null
  }
  if (!active) return
  const jobId = active.jobId
  if (active.intent !== 'cancel') active.intent = 'shutdown'
  active.controller.abort(new Error('shutdown'))
  // 抽帧的 ffmpeg 不响应 abort，最多等 10 秒；等不到也照常退出，启动时会把 running 条目放回 pending
  await Promise.race([
    waitForActiveToEnd(jobId),
    new Promise((resolve) => setTimeout(resolve, 10_000))
  ])
}

// ==================== 执行 ====================

function kick(): void {
  if (loopRunning) return
  loopRunning = true
  void (async () => {
    try {
      let job: AnalysisJobRow | undefined
      while (!stopping && (job = nextQueuedJob())) {
        await runJob(job)
      }
    } catch (error) {
      console.error('[AI] 队列循环异常退出:', error)
    } finally {
      loopRunning = false
      broadcast()
    }
  })()
}

async function runJob(job: AnalysisJobRow): Promise<void> {
  const run: ActiveRun = {
    jobId: job.id,
    controller: new AbortController(),
    intent: null,
    current: new Map()
  }
  active = run
  const options = parseJobOptions(job)
  let workersFailed: string | null = null
  try {
    updateJobStatus(job.id, 'running', { started: true, error: null })
    broadcast()
    const provider = resolveProvider(job.provider_id)
    const client = createClientFor(provider.id)
    const limiter = limiterFor(provider.id, options.rpm)
    const asrProvider = options.transcribe ? resolveAsrProvider(options.asrProviderId) : null
    const asr = asrProvider
      ? {
          client: createAsrClient(asrProvider),
          provider: asrProvider,
          limiter: limiterFor(`asr:${asrProvider.id}`, options.asrRpm)
        }
      : null
    const prompts = {
      single: buildSinglePrompt(job.prompt),
      segment: buildSegmentPrompt(job.prompt),
      reduce: buildReducePrompt(job.prompt)
    }

    const worker = async (): Promise<void> => {
      try {
        while (!run.controller.signal.aborted) {
          const [postId] = claimPendingItems(job.id, 1)
          if (postId === undefined) return
          await processItem(job.id, postId, run, {
            client,
            limiter,
            model: provider.model,
            asr,
            prompts,
            plan: {
              segmentSeconds: options.segmentSeconds,
              maxMinutes: options.maxMinutes,
              skipOverMinutes: options.skipOverMinutes,
              framesShort: options.framesShort,
              framesPerSegment: options.framesPerSegment,
              mosaic: options.mosaic
            },
            tagMode: options.tagMode,
            signal: run.controller.signal
          })
        }
      } catch (error) {
        // 一个 worker 因数据库等非分析错误崩了，其它 worker 不能继续往「已失败」的作业里写
        run.controller.abort(error instanceof Error ? error : new Error(String(error)))
        throw error
      }
    }
    // 等所有 worker 都退出再收尾，否则收尾把条目放回 pending 后还会被幸存的 worker 重新领走
    const results = await Promise.allSettled(Array.from({ length: options.concurrency }, worker))
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failure && run.intent === null) throw failure.reason
  } catch (error) {
    workersFailed = (error as Error).message
    console.error(`[AI] 作业 #${job.id} 无法执行:`, error)
  } finally {
    active = null
  }

  // 收尾：按意图决定作业去向
  if (run.intent === 'pause') {
    releaseRunningItems(job.id)
    recountJob(job.id)
    updateJobStatus(job.id, 'paused')
  } else if (run.intent === 'shutdown') {
    // 退出打断的回到 queued，下次启动自动续跑
    releaseRunningItems(job.id)
    recountJob(job.id)
    updateJobStatus(job.id, 'queued')
  } else if (run.intent === 'cancel') {
    releaseRunningItems(job.id)
    recountJob(job.id)
    updateJobStatus(job.id, 'cancelled', { finished: true })
  } else if (workersFailed) {
    releaseRunningItems(job.id)
    recountJob(job.id)
    updateJobStatus(job.id, 'failed', { error: workersFailed, finished: true })
  } else {
    recountJob(job.id)
    const fresh = getAnalysisJob(job.id)
    const allFailed = !!fresh && fresh.total > 0 && fresh.done === 0 && fresh.failed === fresh.total
    updateJobStatus(job.id, allFailed ? 'failed' : 'completed', {
      error: allFailed ? '全部条目分析失败，请查看条目错误' : null,
      finished: true
    })
    console.log(
      `[AI] 作业 #${job.id} 结束：成功 ${fresh?.done ?? 0}，失败 ${fresh?.failed ?? 0}，跳过 ${fresh?.skipped ?? 0}`
    )
  }
  pruneFinishedJobs()
  broadcast()
}

async function processItem(
  jobId: number,
  postId: number,
  run: ActiveRun,
  options: Omit<PipelineOptions, 'onStage'>
): Promise<void> {
  const post = getPostById(postId)
  if (!post) {
    finishItem(jobId, postId, 'skipped', '作品已不存在')
    broadcast()
    return
  }
  const title = postTitle(post)
  run.current.set(postId, title)
  broadcast()
  const onStage = (stage: AnalysisStage, detail?: string): void => {
    run.current.set(
      postId,
      `${title} · ${ANALYSIS_STAGE_LABELS[stage]}${detail ? ` ${detail}` : ''}`
    )
    broadcast()
  }
  try {
    const result = await analyzePost(post, { ...options, onStage })
    finishItem(jobId, postId, 'done', null)
    console.log(
      `[AI] 作品 ${post.aweme_id} 分析完成：${result.meta.segmentCount} 段 / ${result.meta.frameCount} 帧 / ` +
        `${result.keptTags.length} 标签，${Math.round(result.meta.elapsedMs / 1000)} 秒`
    )
    broadcast({ jobId, postId, ok: true, title, error: null })
  } catch (error) {
    if (run.controller.signal.aborted) {
      // 暂停 / 取消打断的条目不算失败，收尾时统一放回 pending
      return
    }
    const message = describeError(error)
    if ((error as Error)?.name === 'VideoTooLongError') {
      finishItem(jobId, postId, 'skipped', message)
      broadcast({ jobId, postId, ok: false, title, error: message })
      return
    }
    console.error(`[AI] 作品 ${post.aweme_id} 分析失败: ${message}`)
    finishItem(jobId, postId, 'failed', message)
    broadcast({ jobId, postId, ok: false, title, error: message })
  } finally {
    run.current.delete(postId)
  }
}

function describeError(error: unknown): string {
  const err = error as Error & { raw?: string }
  if (err?.name === 'TimeoutError') return '请求超时（长时间无响应）'
  const message = err?.message || String(error)
  return message.length > 500 ? `${message.slice(0, 500)}…` : message
}

// ==================== 启动恢复 / 自动入队 ====================

/** 应用启动时调用：把上次没跑完的作业接着排队；订阅下载完成事件实现自动分析 */
export function initAnalysisQueue(): void {
  const db = getDatabase()
  stopping = false
  releaseRunningItems()
  const interrupted = db
    .prepare(`UPDATE analysis_jobs SET status = 'queued' WHERE status = 'running'`)
    .run().changes
  if (interrupted > 0) console.log(`[AI] 恢复 ${interrupted} 个上次未完成的分析作业`)
  for (const job of db
    .prepare(`SELECT id FROM analysis_jobs WHERE status IN ('queued','paused')`)
    .all() as {
    id: number
  }[]) {
    recountJob(job.id)
  }

  appEvents.on('script-hook', (event: { hook: string; post?: { id: number } }) => {
    if (event.hook !== 'post.downloaded' || !event.post) return
    if (getSetting('analysis_auto') !== 'true') return
    scheduleAutoJob(event.post.id)
  })

  // 延后几秒再开跑，让窗口先起来
  setTimeout(kick, 5000)
}

/** 下载是成批到达的，攒 30 秒合成一个作业，而不是一条作品一个作业 */

function scheduleAutoJob(postId: number): void {
  autoPending.add(postId)
  if (autoTimer) return
  autoTimer = setTimeout(() => {
    autoTimer = null
    const ids = Array.from(autoPending)
    autoPending = new Set()
    try {
      createJob({ kind: 'auto', postIds: ids })
    } catch (error) {
      console.warn('[AI] 自动分析入队失败:', (error as Error).message)
    }
  }, 30_000)
}

/** 便于其他模块（脚本 API）直接把某作者的未分析作品排进去 */
export function enqueueUnanalyzed(secUid?: string, providerId?: string): AnalysisJobView {
  return createJob({ kind: 'analyze', secUid, onlyUnanalyzed: true, providerId })
}

export function enqueueReanalyze(postIds: number[], providerId?: string): AnalysisJobView {
  const existing = postIds.filter((id) => !!getPostById(id))
  if (!existing.length) throw new Error('没有可重新分析的作品')
  return createJob({ kind: 'reanalyze', postIds: existing, priority: true, providerId })
}
