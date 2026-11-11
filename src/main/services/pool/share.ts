/**
 * 共享计划：开启并登录后，
 * - 下载作品前先问共享池，池里有就从池里下（扣 1 分），省掉一次抖音请求；
 * - 从抖音下载完成的作品自动上传到池里（首个上传者得分）；
 * - 作者资料和作品列表上传到池里。这两样目前只收不发，客户端不从池里读。
 * 共享池出任何错都只记日志，不影响正常下载。
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'fs'
import { readFile } from 'fs/promises'
import { basename, join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as WebReadableStream } from 'stream/web'
import { getSetting, getUserById, type DbUser } from '../../database'
import { normalizeCreatorPlatform } from '../../../shared/platforms'
import { appEvents } from '../app-events'
import { localFileNameFor, parseObjectKey, planPostObjects, postKeyPrefix } from '../storage/keys'
import { PoolError, poolApi, poolFetch, type PoolPost } from './client'

const PLATFORM = 'douyin'
/** 单个文件超过 90MiB 的作品不上传（共享池域名单请求上限 100MB） */
export const POOL_MAX_FILE_BYTES = 90 * 1024 * 1024
/** 与服务端 MIN_ITEM_BYTES 一致，太小的多半是坏文件 */
const POOL_MIN_ITEM_BYTES = 10 * 1024
const POSTS_BATCH = 200
const FILE_TIMEOUT_MS = 10 * 60_000

/** 开关打开且已登录时返回令牌，否则 null */
export function activePoolToken(): string | null {
  if (getSetting('pool_enabled') !== 'true') return null
  return getSetting('pool_token') || null
}

function logError(action: string, error: unknown): void {
  console.warn(`[Pool] ${action}失败:`, (error as Error).message || String(error))
}

/** 上传失败后的等待时长，长度就是重试次数：最多重试 3 次 */
const RETRY_DELAYS_MS = [2_000, 8_000, 30_000]

/**
 * 网络错误和服务端 5xx 才重试。4xx（已存在、额度、登录失效、限流、签名过期）重试也没用。
 * 每一步单独重试，不重来整条作品：申请上传会占用每天的上传次数。
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (error) {
      const retryable = !(error instanceof PoolError) || error.status >= 500
      if (!retryable || i >= RETRY_DELAYS_MS.length) throw error
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i]))
    }
  }
}

// ---------- 从池里下载 ----------

const LOOKUP_BATCH = 500
const LOOKUP_TIMEOUT_MS = 10_000

/**
 * 一次查出这批作品里哪些在池里，下载前调用一次。
 * 未加入、网络不通、出错时返回已查到的部分（通常是空集合），本次就不走共享池，不拖慢抖音下载。
 */
export async function lookupPool(awemeIds: string[]): Promise<Set<string>> {
  const found = new Set<string>()
  const token = activePoolToken()
  if (!token) return found
  try {
    for (let i = 0; i < awemeIds.length; i += LOOKUP_BATCH) {
      const { items } = await poolApi.lookup(
        token,
        PLATFORM,
        awemeIds.slice(i, i + LOOKUP_BATCH),
        LOOKUP_TIMEOUT_MS
      )
      for (const item of items) found.add(item.itemId)
    }
  } catch (error) {
    logError('查询共享池', error)
  }
  return found
}

/** 从池里下载过的作品，下载完成后不必再上传 */
const fromPool = new Set<string>()

/**
 * 池里有这条作品就下到 folderPath，文件名沿用 polydl 的命名（前缀取目录名）。
 * 返回 false 表示没下（池里没有、额度不足、网络出错），调用方照常走抖音。
 */
export async function downloadFromPool(awemeId: string, folderPath: string): Promise<boolean> {
  const token = activePoolToken()
  if (!token) return false
  let files: { name: string; size: number; url: string }[]
  try {
    files = (await poolApi.download(token, PLATFORM, awemeId)).files
  } catch (error) {
    if (!(error instanceof PoolError && error.status === 404))
      logError(`查询作品 ${awemeId} `, error)
    return false
  }

  mkdirSync(folderPath, { recursive: true })
  const prefix = basename(folderPath)
  const done: { tmp: string; target: string }[] = []
  try {
    for (const f of files) {
      const parsed = parseObjectKey(postKeyPrefix('_', awemeId) + f.name)
      if (!parsed) continue
      const res = await poolFetch(f.url, { signal: AbortSignal.timeout(FILE_TIMEOUT_MS) })
      if (!res.ok || !res.body) throw new Error(`${f.name} 下载失败：HTTP ${res.status}`)
      const target = join(
        folderPath,
        localFileNameFor(prefix, parsed.kind, parsed.idx, res.headers.get('content-type'))
      )
      // .tmp 后缀：中途失败时 cleanupFailedDownload 会删掉
      const tmp = `${target}.tmp`
      done.push({ tmp, target })
      await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(tmp))
      if (statSync(tmp).size !== f.size) throw new Error(`${f.name} 大小不一致`)
    }
    if (!done.length) return false
    for (const { tmp, target } of done) renameSync(tmp, target)
    fromPool.add(awemeId)
    console.log(`[Pool] 作品 ${awemeId} 从共享池下载`)
    return true
  } catch (error) {
    for (const { tmp } of done) rmSync(tmp, { force: true })
    logError(`从共享池下载作品 ${awemeId} `, error)
    return false
  }
}

// ---------- 上传作品文件 ----------

interface ShareJob {
  awemeId: string
  folderPath: string
}
const queue: ShareJob[] = []
let running = false

/** 本地作品目录 → 要上传的文件；不该上传时返回 null（只有封面、单个文件超限、总量太小） */
export interface ShareFile {
  /** 共享池里的文件名，如 video.mp4、images/0.jpg */
  name: string
  size: number
  contentType: string
  path: string
}

export function planShareFiles(folderPath: string, awemeId: string): ShareFile[] | null {
  const base = postKeyPrefix('_', awemeId)
  const plan = planPostObjects(readdirSync(folderPath), '_', awemeId)
  if (!plan.some((o) => o.kind !== 'cover')) return null
  const files = plan.map((o) => ({
    name: o.key.slice(base.length),
    size: statSync(join(folderPath, o.file)).size,
    contentType: o.contentType,
    path: join(folderPath, o.file)
  }))
  if (files.some((f) => f.size < 1 || f.size > POOL_MAX_FILE_BYTES)) return null
  if (files.reduce((n, f) => n + f.size, 0) < POOL_MIN_ITEM_BYTES) return null
  return files
}

async function sharePost(token: string, { awemeId, folderPath }: ShareJob): Promise<void> {
  if (!existsSync(folderPath)) return
  const files = planShareFiles(folderPath, awemeId)
  if (!files) return
  let uploads
  try {
    uploads = (
      await withRetry(() =>
        poolApi.requestUpload(
          token,
          PLATFORM,
          awemeId,
          files.map(({ name, size, contentType }) => ({ name, size, contentType }))
        )
      )
    ).uploads
  } catch (error) {
    // 已经有人传过或正在传
    if (error instanceof PoolError && error.status === 409) return
    throw error
  }
  for (const u of uploads) {
    const file = files.find((f) => f.name === u.name)!
    // 整个读进内存（单个文件不超过 90MiB），让 fetch 自动带上 Content-Length，服务端要核对
    const body = await readFile(file.path)
    await withRetry(async () => {
      const res = await poolFetch(u.url, {
        method: u.method,
        headers: u.headers,
        body,
        signal: AbortSignal.timeout(FILE_TIMEOUT_MS)
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: unknown } | null
        throw new PoolError(res.status, typeof json?.error === 'string' ? json.error : 'http_error')
      }
    })
  }
  const { credits } = await withRetry(() => poolApi.completeUpload(token, PLATFORM, awemeId))
  console.log(`[Pool] 作品 ${awemeId} 已上传到共享池，额度 ${credits}`)
}

async function drainQueue(): Promise<void> {
  if (running) return
  running = true
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const token = activePoolToken()
      if (!token) {
        queue.length = 0
        return
      }
      await sharePost(token, job).catch((error) => logError(`上传作品 ${job!.awemeId} `, error))
    }
  } finally {
    running = false
  }
}

// ---------- 作者资料和作品列表（只收不发） ----------

export function shareAuthor(user: DbUser): void {
  const token = activePoolToken()
  if (!token || normalizeCreatorPlatform(user.platform) !== PLATFORM) return
  const profile = {
    nickname: user.nickname || undefined,
    signature: user.signature || undefined,
    avatar: user.avatar || undefined,
    uid: user.uid || undefined,
    shortId: user.short_id || undefined,
    uniqueId: user.unique_id || undefined,
    followerCount: user.follower_count ?? undefined,
    followingCount: user.following_count ?? undefined,
    totalFavorited: user.total_favorited ?? undefined,
    awemeCount: user.aweme_count ?? undefined
  }
  void withRetry(() => poolApi.putProfile(token, PLATFORM, user.sec_uid, profile)).catch((error) =>
    logError(`上传作者 ${user.sec_uid} 资料`, error)
  )
}

/**
 * polydl 的 createTime 字符串 → 发布时间（Unix 秒）。
 * polydl 的 timestamp2Str 把时间加 8 小时、再减本机时区偏移，然后按 UTC 取年月日时分秒，
 * 所以字符串跟本机时区有关（UTC+8 的电脑上比北京时间快 8 小时）。这里照原公式反算。
 * 作品 ID 的高 32 位是上传时间，不是发布时间，不能用。
 */
export function createTimeOf(createTime?: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2})$/.exec(createTime ?? '')
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number)
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s)
  return (asUtc - 8 * 3600_000 + new Date(asUtc).getTimezoneOffset() * 60_000) / 1000
}

interface ListedAweme {
  awemeId?: string
  awemeType?: number
  desc?: string
  descRaw?: string
  caption?: string
  createTime?: string
}

/**
 * 上传一次同步翻到的作品列表。reachedEnd：从第一页连续翻到了列表末尾，
 * 只有这时才告诉服务端「从头开始、到底为止」，其余情况两个标志都是 false。
 */
export function sharePostList(secUid: string, listed: ListedAweme[], reachedEnd: boolean): void {
  const token = activePoolToken()
  if (!token || !listed.length) return
  const posts: PoolPost[] = []
  for (const a of listed) {
    if (!a.awemeId) continue
    const createTime = createTimeOf(a.createTime)
    if (createTime === null) continue
    posts.push({
      itemId: a.awemeId,
      createTime,
      awemeType: a.awemeType,
      desc: a.desc?.slice(0, 5000),
      descRaw: a.descRaw?.slice(0, 5000),
      caption: a.caption?.slice(0, 5000)
    })
  }
  void (async () => {
    for (let i = 0; i < posts.length; i += POSTS_BATCH) {
      const last = i + POSTS_BATCH >= posts.length
      const flag = reachedEnd && last
      await withRetry(() =>
        poolApi.putPosts(token, PLATFORM, secUid, posts.slice(i, i + POSTS_BATCH), {
          fromStart: flag,
          reachedEnd: flag
        })
      )
    }
  })().catch((error) => logError(`上传作者 ${secUid} 作品列表`, error))
}

// ---------- 启动 ----------

export function initPoolShare(): void {
  appEvents.on(
    'script-hook',
    (event: {
      hook: string
      post?: { awemeId: string; userId: number }
      folderPath?: string
      user?: { id: number }
    }) => {
      try {
        if (event.hook === 'post.downloaded' && event.post && event.folderPath) {
          const { awemeId, userId } = event.post
          if (fromPool.delete(awemeId) || !activePoolToken()) return
          if (normalizeCreatorPlatform(getUserById(userId)?.platform) !== PLATFORM) return
          queue.push({ awemeId, folderPath: event.folderPath })
          void drainQueue()
        } else if (event.hook === 'user.added' && event.user) {
          const user = getUserById(event.user.id)
          if (user) shareAuthor(user)
        }
      } catch (error) {
        // 共享出错不能影响下载
        logError('处理共享事件', error)
      }
    }
  )
}
