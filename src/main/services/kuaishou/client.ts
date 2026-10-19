import { net } from 'electron'
import { getSetting } from '../../database'
import { extractCreatorLink } from '../../../shared/platforms'
import { extractKuaishouPageDetail, type KuaishouPageDetail } from './html'
import { pageFromFeed, type KuaishouFeedPage } from './feed'
import { parseKuaishouInput } from './parse'

export const KUAISHOU_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const PAGE_HEADERS = {
  Origin: 'https://www.kuaishou.com',
  Referer: 'https://www.kuaishou.com/new-reco'
}

export function kuaishouCookie(): string {
  return (getSetting('kuaishou_cookie') || '').trim()
}

export function kuaishouHeaders(referer = 'https://www.kuaishou.com/'): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': KUAISHOU_USER_AGENT,
    Accept: 'text/html,application/json',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    ...PAGE_HEADERS,
    Referer: referer
  }
  const cookie = kuaishouCookie()
  if (cookie) headers.Cookie = cookie
  return headers
}

export async function resolveKuaishouAddress(input: string): Promise<string> {
  const extracted = extractCreatorLink(input)?.url ?? input.trim()
  const parsed = parseKuaishouInput(extracted)
  if (parsed.kind !== 'short') return extracted
  const response = await net.fetch(parsed.url, {
    headers: { 'User-Agent': KUAISHOU_USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000)
  })
  return response.url || extracted
}

export async function loadKuaishouWork(input: string): Promise<{
  detail: KuaishouPageDetail
  pageUrl: string
}> {
  const pageUrl = await resolveKuaishouAddress(input)
  const parsed = parseKuaishouInput(pageUrl)
  if (parsed.kind !== 'work') throw new Error('无法识别的快手作品链接')
  const html = await fetchText(pageUrl, pageUrl)
  const detail = extractKuaishouPageDetail(html, parsed.photoId, parsed.web)
  if (!detail?.photoId) throw new Error('作品页里没有可下载的数据，请配置快手 Cookie 后重试')
  if (!detail.authorId && parsed.userId) detail.authorId = parsed.userId
  return { detail, pageUrl }
}

export async function fetchProfileFeed(userId: string, cursor = ''): Promise<KuaishouFeedPage> {
  const referer = `https://www.kuaishou.com/profile/${userId}`
  const response = await net.fetch('https://www.kuaishou.com/rest/v/profile/feed', {
    method: 'POST',
    headers: {
      ...kuaishouHeaders(referer),
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ user_id: userId, pcursor: cursor, page: 'profile' }),
    signal: AbortSignal.timeout(20_000)
  })
  if (!response.ok) throw new Error(`快手投稿接口 HTTP ${response.status}`)
  const payload = (await response.json()) as { feeds?: unknown; error_msg?: string }
  if (!Array.isArray(payload.feeds)) {
    throw new Error(payload.error_msg || '获取快手投稿失败，请在系统设置里配置快手 Cookie')
  }
  return pageFromFeed(payload)
}

async function fetchText(url: string, referer: string): Promise<string> {
  const response = await net.fetch(url, {
    headers: kuaishouHeaders(referer),
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000)
  })
  if (!response.ok) throw new Error(`快手页面 HTTP ${response.status}`)
  return response.text()
}

export function kuaishouPause(): Promise<void> {
  const delay = 1200 + Math.floor(Math.random() * 800)
  return new Promise((resolve) => setTimeout(resolve, delay))
}
