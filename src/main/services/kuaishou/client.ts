import {
  KuaishouHandler,
  KuaishouLoginError,
  KuaishouRestClient,
  KuaishouRiskError,
  normalizeWorks,
  parseCount,
  parseKuaishouTarget,
  resolveShortUrl,
  userAgentOf,
  type KuaishouWork
} from 'polydl'
import { getSetting } from '../../database'
import { extractCreatorLink } from '../../../shared/platforms'
import { getDeviceProfile } from '../douyin/device'
import { markKuaishouCaptcha, markKuaishouQuota, withKuaishouApiThrottle } from './guard'

export const KUAISHOU_LOGIN_MESSAGE = '快手未登录或登录已失效，请在系统设置里登录快手'

export interface KuaishouProfile {
  name: string
  avatar: string
  signature: string
  follower: number
  following: number
  photoCount: number
}

export interface KuaishouFeedPage {
  works: KuaishouWork[]
  pcursor: string
  finished: boolean
}

let cached: { cookie: string; rest: KuaishouRestClient; handler: KuaishouHandler } | null = null

export function kuaishouCookie(): string {
  return (getSetting('kuaishou_cookie') || '').trim()
}

/** 和登录窗口同一套设备 UA。签名器要长期持有（内部计数递增），Cookie 不变就复用 */
function clients(): { rest: KuaishouRestClient; handler: KuaishouHandler } {
  const cookie = kuaishouCookie()
  if (!cookie) throw new Error(KUAISHOU_LOGIN_MESSAGE)
  if (cached?.cookie !== cookie) {
    const userAgent = userAgentOf(getDeviceProfile())
    cached = {
      cookie,
      rest: new KuaishouRestClient({ cookie, userAgent }),
      handler: new KuaishouHandler({ cookie, headers: { 'User-Agent': userAgent } })
    }
  }
  return cached
}

/** 排队执行一次快手请求，把 polydl 的登录 / 风控错误换成用户看得懂的提示 */
function callKuaishou<T>(task: () => Promise<T>): Promise<T> {
  return withKuaishouApiThrottle(async () => {
    try {
      return await task()
    } catch (error) {
      if (error instanceof KuaishouLoginError) throw new Error(KUAISHOU_LOGIN_MESSAGE)
      if (error instanceof KuaishouRiskError) markKuaishouCaptcha()
      throw error
    }
  })
}

/** 主页、作品、直播主页、短链和分享文案统一解析成作者 ID 或作品 ID */
export async function resolveKuaishouTarget(
  input: string
): Promise<{ kind: 'profile' | 'photo'; id: string }> {
  const text = extractCreatorLink(input)?.url ?? input.trim()
  let target = parseKuaishouTarget(text)
  if (target.kind === 'short') {
    target = parseKuaishouTarget(await callKuaishou(() => resolveShortUrl(text)))
  }
  if (target.kind === 'photo') return { kind: 'photo', id: target.id }
  if (target.kind === 'profile' || target.kind === 'live-user') {
    return { kind: 'profile', id: target.id }
  }
  throw new Error('无法识别的快手链接，请使用创作者主页或作品链接')
}

export async function fetchKuaishouProfile(userId: string): Promise<KuaishouProfile> {
  const { handler } = clients()
  const data = await callKuaishou(() => handler.fetchUserProfile(userId))
  if (data.result !== 1) throw new Error(`快手资料接口返回 result=${data.result ?? '空'}`)
  const { profile, ownerCount } = data.userProfile
  return {
    name: (profile.user_name || '').trim(),
    avatar: profile.headurl || '',
    signature: profile.user_text || '',
    // 计数可能是「203.4万」这样的字符串
    follower: parseCount(ownerCount.fan),
    following: parseCount(ownerCount.follow),
    // photo 字段常为 null，公开作品数在 photo_public
    photoCount: parseCount(ownerCount.photo_public) || parseCount(ownerCount.photo)
  }
}

/** 投稿列表一页。走签名 REST，拿得到原始 result，限额才能和其他失败分开 */
export async function fetchKuaishouFeedPage(
  userId: string,
  pcursor = ''
): Promise<KuaishouFeedPage> {
  const { rest } = clients()
  const data = await callKuaishou(() =>
    rest.call<{ result?: number; pcursor?: string; feeds?: unknown[] }>(
      'POST',
      '/rest/v/profile/feed',
      { user_id: userId, pcursor, page: 'profile' },
      {
        referer: `https://www.kuaishou.com/profile/${userId}`,
        extraHeaders: { profile_referer: '' }
      }
    )
  )
  if (data.result === 2) markKuaishouQuota()
  if (data.result !== 1) throw new Error(`快手投稿接口返回 result=${data.result ?? '空'}`)
  const next = data.pcursor || ''
  return {
    works: normalizeWorks(data.feeds ?? []).filter((work) => work.workId),
    pcursor: next,
    finished: !next || next === 'no_more'
  }
}

export async function fetchKuaishouWork(photoId: string): Promise<KuaishouWork> {
  const { handler } = clients()
  const work = await callKuaishou(() => handler.fetchWork(photoId))
  if (!work.workId) throw new Error('作品详情里没有可下载的数据')
  return work
}
