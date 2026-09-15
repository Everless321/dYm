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
import { analyzeOnePost } from './analyzer'
import { buildSystemPrompt, getAnalysisPrompt } from './prompt'

const QUEUE_CHANNEL = 'analysis:queue'
const BROADCAST_THROTTLE_MS = 150

// ==================== 设置 ====================

function intSetting(key: string, fallback: number): number {
  return Math.max(1, parseInt(getSetting(key) || '') || fallback)
}

export function getAnalysisSettings(): AnalysisSettings {
  return {
    prompt: getAnalysisPrompt(),
    slices: intSetting('analysis_slices', ANALYSIS_DEFAULTS.slices),
    concurrency: intSetting('analysis_concurrency', ANALYSIS_DEFAULTS.concurrency),
    rpm: intSetting('analysis_rpm', ANALYSIS_DEFAULTS.rpm),
    tagMode: getSetting('analysis_tag_mode') === 'closed' ? 'closed' : 'open',
    autoAnalyze: getSetting('analysis_auto') === 'true'
  }
}

// ==================== 队列状态 ====================

interface ActiveRun {
  jobId: number
  controller: AbortController
  intent: 'pause' | 'cancel' | null
  current: Map<number, string>
}

let loopRunning = false
let active: ActiveRun | null = null
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
  const payload: AnalysisQueueEvent = { jobs: listJobs() }
  if (pendingItemDone) {
    payload.itemDone = pendingItemDone
    pendingItemDone = undefined
  }
  sendToWindows(payload)
}

/** 作业列表快照节流推送；带 itemDone 的事件立即发（对话框要逐条更新） */
function broadcast(itemDone?: AnalysisQueueEvent['itemDone']): void {
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
  const row = insertAnalysisJob({
    name: input.name?.trim() || defaultJobName(input, postIds.length),
    kind: input.kind ?? 'analyze',
    providerId: provider.id,
    prompt: settings.prompt,
    options: {
      slices: settings.slices,
      concurrency: settings.concurrency,
      rpm: settings.rpm,
      tagMode: settings.tagMode
    },
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
    active.intent = 'pause'
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
  if (!active) return
  const jobId = active.jobId
  active.intent = 'pause'
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
      while ((job = nextQueuedJob())) {
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
  updateJobStatus(job.id, 'running', { started: true, error: null })
  broadcast()

  const options = parseJobOptions(job)
  let workersFailed: string | null = null
  try {
    const provider = resolveProvider(job.provider_id)
    const client = createClientFor(provider.id)
    const limiter = limiterFor(provider.id, options.rpm)
    const systemPrompt = buildSystemPrompt(job.prompt)

    const worker = async (): Promise<void> => {
      while (!run.controller.signal.aborted) {
        const [postId] = claimPendingItems(job.id, 1)
        if (postId === undefined) return
        await processItem(job.id, postId, run, {
          client,
          limiter,
          systemPrompt,
          slices: options.slices,
          tagMode: options.tagMode,
          signal: run.controller.signal,
          model: provider.model
        })
      }
    }
    await Promise.all(Array.from({ length: options.concurrency }, worker))
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
  options: Parameters<typeof analyzeOnePost>[1]
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
  try {
    await analyzeOnePost(post, options)
    finishItem(jobId, postId, 'done', null)
    broadcast({ jobId, postId, ok: true, title, error: null })
  } catch (error) {
    if (run.controller.signal.aborted) {
      // 暂停 / 取消打断的条目不算失败，收尾时统一放回 pending
      return
    }
    const message = describeError(error)
    console.error(`[AI] 作品 ${post.aweme_id} 分析失败: ${message}`)
    finishItem(jobId, postId, 'failed', message)
    broadcast({ jobId, postId, ok: false, title, error: message })
  } finally {
    run.current.delete(postId)
  }
}

function describeError(error: unknown): string {
  const err = error as Error & { raw?: string }
  if (err?.name === 'TimeoutError') return '请求超时（120 秒无响应）'
  const message = err?.message || String(error)
  return message.length > 500 ? `${message.slice(0, 500)}…` : message
}

// ==================== 启动恢复 / 自动入队 ====================

/** 应用启动时调用：把上次没跑完的作业接着排队；订阅下载完成事件实现自动分析 */
export function initAnalysisQueue(): void {
  const db = getDatabase()
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
let autoPending = new Set<number>()
let autoTimer: NodeJS.Timeout | null = null

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
