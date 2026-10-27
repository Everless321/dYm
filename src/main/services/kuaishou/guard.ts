/**
 * 快手接口的排队和冷却。不依赖 Electron，方便单测。
 *
 * 投稿列表连续翻几十到一百多条后返回 result=2（限流），整个账号的网页也一起被限，实测约 10 分钟恢复；
 * 滑块验证码出现后继续请求只会更糟。两种情况都立刻停，冷却期内拒绝后续接口请求。
 * polydl 不做限速，节奏全在这里。
 */

export const API_GAP_MS = 5000
export const API_JITTER_MS = 2000
export const DOWNLOAD_GAP_MS = 2000
export const DOWNLOAD_JITTER_MS = 1000
/** 实测约 10 分钟恢复，多留 2 分钟；冷却中再请求可能延长限流 */
export const QUOTA_COOLDOWN_MS = 12 * 60_000
export const CAPTCHA_COOLDOWN_MS = 30 * 60_000

export type KuaishouCooldownKind = 'quota' | 'captcha'

/** 限流或验证码。限流可以等冷却结束再接着翻；验证码要用户处理。已经列出来的作品都仍可以下载 */
export class KuaishouCooldownError extends Error {
  constructor(
    message: string,
    readonly kind: KuaishouCooldownKind
  ) {
    super(message)
    this.name = 'KuaishouCooldownError'
  }
}

let apiQueue: Promise<unknown> = Promise.resolve()
let downloadQueue: Promise<unknown> = Promise.resolve()
let lastApiAt = 0
let lastDownloadAt = 0
let cooldownUntil = 0
let cooldownReason = ''
let cooldownKind: KuaishouCooldownKind = 'quota'

/** 单测重置模块级队列。正式代码不要调用。 */
export function resetKuaishouGuardForTests(): void {
  apiQueue = Promise.resolve()
  downloadQueue = Promise.resolve()
  lastApiAt = 0
  lastDownloadAt = 0
  cooldownUntil = 0
  cooldownReason = ''
  cooldownKind = 'quota'
}

export function markKuaishouQuota(): never {
  return startCooldown('quota', QUOTA_COOLDOWN_MS, '快手限流（result=2）', '约 10 分钟后恢复')
}

export function markKuaishouCaptcha(): never {
  return startCooldown(
    'captcha',
    CAPTCHA_COOLDOWN_MS,
    '快手要求滑块验证',
    '请在系统设置里打开快手网页完成验证，再稍后同步'
  )
}

function startCooldown(
  kind: KuaishouCooldownKind,
  ms: number,
  reason: string,
  hint: string
): never {
  cooldownUntil = Date.now() + ms
  cooldownReason = reason
  cooldownKind = kind
  throw new KuaishouCooldownError(`${reason}，已暂停访问快手 ${formatWait(ms)}。${hint}`, kind)
}

export function assertKuaishouAvailable(): void {
  const left = kuaishouCooldownLeft()
  if (left > 0) {
    throw new KuaishouCooldownError(
      `${cooldownReason}，还在冷却中，约 ${formatWait(left)}后再试`,
      cooldownKind
    )
  }
}

export function kuaishouCooldownLeft(): number {
  return Math.max(0, cooldownUntil - Date.now())
}

/** 等到冷却结束；中途取消就立刻返回 */
export async function waitKuaishouCooldown(isAborted: () => boolean): Promise<void> {
  while (!isAborted()) {
    const left = kuaishouCooldownLeft()
    if (left === 0) return
    await new Promise((resolve) => setTimeout(resolve, Math.min(left, 1000)))
  }
}

/** 资料、作品详情和投稿列表共用一个队列 */
export function withKuaishouApiThrottle<T>(task: () => Promise<T>): Promise<T> {
  return enqueue(
    () => apiQueue,
    (next) => {
      apiQueue = next
    },
    () => lastApiAt,
    (at) => {
      lastApiAt = at
    },
    API_GAP_MS,
    API_JITTER_MS,
    task,
    true
  )
}

/**
 * 作品文件按条排队。不看接口冷却：限额只封投稿列表，
 * 已经列出来的作品仍应下完。
 */
export function withKuaishouDownloadThrottle<T>(task: () => Promise<T>): Promise<T> {
  return enqueue(
    () => downloadQueue,
    (next) => {
      downloadQueue = next
    },
    () => lastDownloadAt,
    (at) => {
      lastDownloadAt = at
    },
    DOWNLOAD_GAP_MS,
    DOWNLOAD_JITTER_MS,
    task,
    false
  )
}

function enqueue<T>(
  getQueue: () => Promise<unknown>,
  setQueue: (next: Promise<unknown>) => void,
  getLastAt: () => number,
  setLastAt: (at: number) => void,
  gapMs: number,
  jitterMs: number,
  task: () => Promise<T>,
  checkCooldown: boolean
): Promise<T> {
  const run = getQueue().then(async () => {
    if (checkCooldown) assertKuaishouAvailable()
    const wait = getLastAt() + gapMs + Math.random() * jitterMs - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    try {
      return await task()
    } finally {
      setLastAt(Date.now())
    }
  })
  // 失败不能让后面排队的请求一起挂掉，调用方仍拿得到自己的错误
  setQueue(run.catch(() => undefined))
  return run
}

function formatWait(ms: number): string {
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.ceil(minutes / 60)} 小时`
}
