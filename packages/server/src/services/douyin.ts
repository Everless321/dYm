import { DouyinHandler, getSecUserId, getAwemeId, setConfig } from 'dy-downloader'
import { getSetting } from '../database/index.js'

let handler: DouyinHandler | null = null

export function initDouyinHandler(): DouyinHandler | null {
  const cookie = getSetting('douyin_cookie')
  if (cookie) {
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

export type LinkType = 'user' | 'video' | 'unknown'

export interface LinkParseResult {
  type: LinkType
  id: string
}

export async function parseDouyinUrl(url: string): Promise<LinkParseResult> {
  console.log('[Douyin] parseDouyinUrl:', url)

  try {
    const secUserId = await getSecUserId(url)
    if (secUserId) {
      console.log('[Douyin] Detected as user link, secUserId:', secUserId)
      return { type: 'user', id: secUserId }
    }
  } catch (e) {
    console.log('[Douyin] Not a user link:', (e as Error).message)
  }

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

export async function fetchUserProfileBySecUid(secUserId: string) {
  if (!handler) {
    throw new Error('DouyinHandler not initialized, please set cookie first')
  }
  console.log('[Douyin] fetchUserProfileBySecUid:', secUserId)
  const profile = await handler.fetchUserProfile(secUserId)
  console.log('[Douyin] profile:', JSON.stringify(profile, null, 2))
  return profile
}

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
