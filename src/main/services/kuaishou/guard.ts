/**
 * 快手接口的排队、限额和结果判断。不依赖 Electron，方便单测。
 *
 * 投稿列表大约 150 条之后返回 result=2，要过几个小时才恢复。
 * 触发后立刻停，并在冷却期内拒绝后续请求，避免继续打接口把封禁拖长。
 */

export const API_GAP_MS = 5000
export const API_JITTER_MS = 2000
export const DOWNLOAD_GAP_MS = 2000
export const DOWNLOAD_JITTER_MS = 1000
export const DOWNLOAD_TIMEOUT_MS = 120_000
/** 快手按条数额度，大约几小时后恢复 */
export const QUOTA_COOLDOWN_MS = 3 * 60 * 60_000

export class KuaishouQuotaError extends Error {
  /** 限额触发前已经保存的作品数，方便同步结果不要报成 0 */
  downloaded = 0
  skipped = 0

  constructor(message: string) {
    super(message)
    this.name = 'KuaishouQuotaError'
  }
}

export type KuaishouApiDecision =
  | { kind: 'ok' }
  | { kind: 'quota' }
  | { kind: 'unsigned' }
  | { kind: 'error'; message: string }

let apiQueue: Promise<unknown> = Promise.resolve()
let downloadQueue: Promise<unknown> = Promise.resolve()
let lastApiAt = 0
let lastDownloadAt = 0
let quotaUntil = 0

/** 单测重置模块级队列。正式代码不要调用。 */
export function resetKuaishouGuardForTests(): void {
  apiQueue = Promise.resolve()
  downloadQueue = Promise.resolve()
  lastApiAt = 0
  lastDownloadAt = 0
  quotaUntil = 0
}

export function interpretKuaishouResult(payload: {
  result?: unknown
  error_msg?: unknown
  feeds?: unknown
}): KuaishouApiDecision {
  const result = Number(payload.result)
  if (result === 2) return { kind: 'quota' }
  if (result === 50) return { kind: 'unsigned' }
  if (Number.isFinite(result) && result !== 1) {
    return { kind: 'error', message: text(payload.error_msg) || `快手接口返回 result=${result}` }
  }
  if (payload.feeds !== undefined && !Array.isArray(payload.feeds)) {
    return { kind: 'error', message: text(payload.error_msg) || '快手投稿接口没有返回列表' }
  }
  return { kind: 'ok' }
}

export function feedSignInput(
  userId: string,
  cursor: string
): {
  url: string
  query: { caver: number }
  form: Record<string, never>
  requestBody: { user_id: string; pcursor: string; page: 'profile' }
} {
  return {
    url: '/rest/v/profile/feed',
    query: { caver: 2 },
    form: {},
    requestBody: { user_id: userId, pcursor: cursor, page: 'profile' }
  }
}

export function signedFeedUrl(sign: string): string {
  return `https://www.kuaishou.com/rest/v/profile/feed?__NS_hxfalcon=${encodeURIComponent(sign)}&caver=2`
}

export function markKuaishouQuota(): never {
  quotaUntil = Date.now() + QUOTA_COOLDOWN_MS
  throw new KuaishouQuotaError(
    `快手投稿接口已到条数限额（result=2），已停止并冷却 ${QUOTA_COOLDOWN_MS / 3_600_000} 小时。大约 150 条后就会触发，请过几小时再同步`
  )
}

export function assertKuaishouAvailable(): void {
  const left = quotaUntil - Date.now()
  if (left > 0) {
    throw new KuaishouQuotaError(`快手投稿接口还在限额冷却中，约 ${formatWait(left)}后再试`)
  }
}

/** 页面、短链和投稿接口共用一个队列 */
export function withKuaishouApiThrottle<T>(task: () => Promise<T>): Promise<T> {
  return enqueue(
    () => apiQueue,
    (next) => {
      apiQueue = next
    },
    () => lastApiAt,
    API_GAP_MS,
    API_JITTER_MS,
    (at) => {
      lastApiAt = at
    },
    task,
    true
  )
}

/**
 * 文件下载单独排队。不看接口限额：result=2 只封投稿列表，
 * 已经列出来的作品仍应下完，不能因为冷却把文件请求一起丢掉。
 */
export function withKuaishouDownloadThrottle<T>(task: () => Promise<T>): Promise<T> {
  return enqueue(
    () => downloadQueue,
    (next) => {
      downloadQueue = next
    },
    () => lastDownloadAt,
    DOWNLOAD_GAP_MS,
    DOWNLOAD_JITTER_MS,
    (at) => {
      lastDownloadAt = at
    },
    task,
    false
  )
}

function enqueue<T>(
  getQueue: () => Promise<unknown>,
  setQueue: (next: Promise<unknown>) => void,
  getLastAt: () => number,
  gapMs: number,
  jitterMs: number,
  setLastAt: (at: number) => void,
  task: () => Promise<T>,
  checkQuota: boolean
): Promise<T> {
  const run = getQueue().then(async () => {
    if (checkQuota) assertKuaishouAvailable()
    const wait = getLastAt() + gapMs + Math.random() * jitterMs - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    try {
      return await task()
    } finally {
      setLastAt(Date.now())
    }
  })
  setQueue(run.catch(() => undefined))
  return run
}

function formatWait(ms: number): string {
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.ceil(minutes / 60)} 小时`
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
