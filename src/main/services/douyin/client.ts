import { DouyinCrawler, DouyinHandler, getSecUserId, getAwemeId, setConfig } from 'polydl'
import { getSetting } from '../../database'
import { getDeviceProfile } from './device'

let handler: DouyinHandler | null = null

export function initDouyinHandler(): DouyinHandler | null {
  const cookie = getSetting('douyin_cookie')
  // 设备指纹先于一切请求就位：没有 Cookie 时静默刷新 / 登录窗口也要用同一份 UA
  const device = getDeviceProfile()
  if (cookie) {
    // A-Bogus 签名 + 与登录环境一致的设备指纹（UA / Client Hints / browser_* 参数同源）
    setConfig({ encryption: 'ab', device })
    handler = new DouyinHandler({ cookie })
    console.log(
      `[Douyin] Handler initialized (A-Bogus, ${device.os} ${device.browser} ${device.browserVersion})`
    )
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
  /** type 为 unknown 时，最后一次解析抛出的错误（如短链跳转失败），没有则表示格式本身不匹配 */
  error?: string
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
  // 短链解析要走网络；断网时不能把「解析失败」说成「链接无法识别」
  let lastError: string | undefined

  // 尝试提取用户 ID
  try {
    const secUserId = await getSecUserId(url)
    if (secUserId) {
      console.log('[Douyin] Detected as user link, secUserId:', secUserId)
      return { type: 'user', id: secUserId }
    }
  } catch (e) {
    lastError = (e as Error).message
    console.log('[Douyin] Not a user link:', lastError)
  }

  // 尝试提取作品 ID
  try {
    const awemeId = await getAwemeId(url)
    if (awemeId) {
      console.log('[Douyin] Detected as video link, awemeId:', awemeId)
      return { type: 'video', id: awemeId }
    }
  } catch (e) {
    lastError = (e as Error).message
    console.log('[Douyin] Not a video link:', lastError)
  }

  return { type: 'unknown', id: '', error: lastError }
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

/**
 * 诊断作品详情接口。
 *
 * polydl 的 `fetchOneVideo` 在主接口报错时会静默吐掉异常（`catch {}`），
 * 回退到移动端分享页，而分享页返回的数据不含作者信息，
 * 表现成“拿到了详情但没有 sec_uid”。这里直接调主接口，
 * 把被吐掉的真实失败原因取出来，仅在失败路径上调用。
 *
 * 返回一句可直接拼进错误消息的中文描述。
 */
export async function diagnosePostDetail(awemeId: string): Promise<string> {
  const cookie = getSetting('douyin_cookie')
  if (!cookie) {
    return '未配置 cookie'
  }

  let res: { status: number; data: unknown }
  try {
    const crawler = new DouyinCrawler({ cookie })
    res = await crawler.fetchPostDetail(awemeId)
  } catch (error) {
    return `详情接口请求失败：${(error as Error).message}`
  }

  const data = res.data as { status_code?: number; status_msg?: string; aweme_detail?: unknown }
  console.log('[Douyin] diagnosePostDetail:', {
    http: res.status,
    status_code: data?.status_code,
    status_msg: data?.status_msg,
    aweme_detail: data?.aweme_detail === null ? 'null' : typeof data?.aweme_detail
  })

  if (data?.aweme_detail == null) {
    return `详情接口返回空作品（HTTP ${res.status}，status_code ${data?.status_code}${
      data?.status_msg ? `，${data.status_msg}` : ''
    }），通常是 cookie 失效或触发风控`
  }

  return `详情接口正常返回但缺少作者字段（HTTP ${res.status}，status_code ${data?.status_code}）`
}

export { getSecUserId, getAwemeId }
