import { DouyinHandler, getSecUserId, getAwemeId, setConfig } from 'dy-downloader'
import { getSetting } from '../database'

let handler: DouyinHandler | null = null

export function initDouyinHandler(): DouyinHandler | null {
  const cookie = getSetting('douyin_cookie')
  if (cookie) {
    // 设置使用 A-Bogus 签名
    setConfig({ encryption: 'ab' })
    handler = new DouyinHandler({ cookie })
    console.log('[Douyin] Handler initialized with A-Bogus encryption')
  } else {
    handler = null
    console.log('[Douyin] No cookie, handler not initialized')
  }
  return handler
}

export function getDouyinHandler(): DouyinHandler | null {
  return handler
}

export function refreshDouyinHandler(): DouyinHandler | null {
  return initDouyinHandler()
}

/**
 * 链接类型
 */
export type LinkType = 'user' | 'video' | 'unknown'

/**
 * 链接识别结果
 */
export interface LinkParseResult {
  type: LinkType
  id: string // sec_user_id 或 aweme_id
}

/**
 * 从用户主页链接直接提取 sec_user_id（不发网络请求）。
 * 形如 https://www.douyin.com/user/MS4wLjABAAAA... → MS4wLjABAAAA...
 * 提取不到返回 null（如短链 v.douyin.com，需走 getSecUserId 解析）。
 */
export function extractSecUidFromUrl(url: string): string | null {
  const match = url.match(/\/user\/([A-Za-z0-9_-]+)/)
  return match ? match[1] : null
}

/**
 * 智能识别抖音链接类型
 * 1. 先尝试提取 sec_user_id（用户链接）
 * 2. 如果失败，尝试提取 aweme_id（作品链接）
 */
export async function parseDouyinUrl(url: string): Promise<LinkParseResult> {
  console.log('[Douyin] parseDouyinUrl:', url)

  // 尝试提取用户 ID
  try {
    const secUserId = await getSecUserId(url)
    if (secUserId) {
      console.log('[Douyin] Detected as user link, secUserId:', secUserId)
      return { type: 'user', id: secUserId }
    }
  } catch (e) {
    console.log('[Douyin] Not a user link:', (e as Error).message)
  }

  // 尝试提取作品 ID
  try {
    const awemeId = await getAwemeId(url)
    if (awemeId) {
      console.log('[Douyin] Detected as video link, awemeId:', awemeId)
      return { type: 'video', id: awemeId }
    }
  } catch (e) {
    console.log('[Douyin] Not a video link:', (e as Error).message)
  }

  return { type: 'unknown', id: '' }
}

/**
 * 从用户链接获取用户资料
 */
export async function fetchUserProfile(url: string) {
  if (!handler) {
    throw new Error('DouyinHandler not initialized, please set cookie first')
  }
  console.log('[Douyin] fetchUserProfile url:', url)
  const secUserId = await getSecUserId(url)
  console.log('[Douyin] secUserId:', secUserId)
  const profile = await handler.fetchUserProfile(secUserId)
  console.log('[Douyin] profile:', JSON.stringify(profile, null, 2))
  return profile
}

/**
 * 从 sec_user_id 获取用户资料
 */
export async function fetchUserProfileBySecUid(secUserId: string) {
  if (!handler) {
    throw new Error('DouyinHandler not initialized, please set cookie first')
  }
  console.log('[Douyin] fetchUserProfileBySecUid:', secUserId)
  const profile = await handler.fetchUserProfile(secUserId)
  console.log('[Douyin] profile:', JSON.stringify(profile, null, 2))
  return profile
}

/**
 * 刷新/同步用户资料的统一入口：
 * 主页链接已含 sec_uid 时优先直接请求（省掉 getSecUserId 一跳），
 * 失败则自动回落到完整解析路径 fetchUserProfile(url)，
 * 保证不会比改动前更差，不影响正常的用户信息同步。
 */
export async function fetchUserProfileSmart(url: string): Promise<unknown> {
  const secUid = extractSecUidFromUrl(url)
  if (!secUid) {
    return fetchUserProfile(url)
  }
  try {
    return await fetchUserProfileBySecUid(secUid)
  } catch (error) {
    console.warn(
      '[Douyin] fetchUserProfileBySecUid failed, fallback to fetchUserProfile:',
      (error as Error).message
    )
    return fetchUserProfile(url)
  }
}

/**
 * 获取作品详情（支持 URL 或 aweme_id）
 */
export async function fetchVideoDetail(urlOrAwemeId: string) {
  if (!handler) {
    throw new Error('DouyinHandler not initialized, please set cookie first')
  }
  console.log('[Douyin] fetchVideoDetail:', urlOrAwemeId)
  try {
    const detail = await handler.fetchOneVideo(urlOrAwemeId)
    console.log('[Douyin] video detail:', JSON.stringify(detail, null, 2))
    return detail
  } catch (error) {
    console.error('[Douyin] fetchVideoDetail error:', error)
    throw error
  }
}

export { getSecUserId, getAwemeId }
