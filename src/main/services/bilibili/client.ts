import { net } from 'electron'
import { getSetting } from '../../database'
import { extractCreatorLink } from '../../../shared/platforms'
import { encodeWbi, wbiQuery } from './wbi'
import type { DashPayload } from './streams'

/** 与 downkyicore 一样按浏览器访问 B 站，不把 Electron 标识带进接口。 */
export const BILIBILI_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const ANON_DM_FIELDS = {
  dm_img_str: 'V2ViR0wgMS',
  dm_img_list: '[]',
  dm_cover_img_str:
    'QU5HTEUgKE5WSURJQSwgTlZJRElBIEdlRm9yY2UgR1RYIDk4MCBEaXJlY3QzRDExIHZzXzVfMCBwc181XzApLCBvciBzaW1pbGFyR29vZ2xlIEluYy4gKE5WSURJQS',
  dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}'
}

/**
 * 所有 api.bilibili.com 请求排成一队：两次之间至少隔 API_GAP_MS，再加随机抖动。
 * 全局生效，并发下载、多个 UP 主同时同步也共用这一个间隔。
 * 视频文件走 CDN，不经过这里。
 */
const API_GAP_MS = 3000
const API_JITTER_MS = 2000
/** 触发风控后这么久内不再请求任何 B 站接口，继续请求只会延长封禁 */
const RISK_COOLDOWN_MS = 10 * 60_000
/** -412 请求被拦截，-352 风控校验失败 */
const RISK_CODES = new Set([-412, -352])

let apiQueue: Promise<unknown> = Promise.resolve()
let lastApiAt = 0
let riskUntil = 0

/** B 站风控拦截。调用方看到它应停止整次同步，而不是跳过当前作品继续 */
export class BilibiliRiskControlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BilibiliRiskControlError'
  }
}

function markRiskControl(reason: string): never {
  riskUntil = Date.now() + RISK_COOLDOWN_MS
  throw new BilibiliRiskControlError(
    `哔哩哔哩触发风控（${reason}），已暂停访问 ${RISK_COOLDOWN_MS / 60_000} 分钟，请稍后再试`
  )
}

function assertNotCoolingDown(): void {
  const left = riskUntil - Date.now()
  if (left > 0) {
    throw new BilibiliRiskControlError(
      `哔哩哔哩风控冷却中，约 ${Math.ceil(left / 60_000)} 分钟后再试`
    )
  }
}

/** 排队执行一次 B 站接口请求 */
export function withApiThrottle<T>(task: () => Promise<T>): Promise<T> {
  const run = apiQueue.then(async () => {
    assertNotCoolingDown()
    const wait = lastApiAt + API_GAP_MS + Math.random() * API_JITTER_MS - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    try {
      return await task()
    } finally {
      lastApiAt = Date.now()
    }
  })
  // 失败不能让后面排队的请求一起挂掉，调用方仍拿得到自己的错误
  apiQueue = run.catch(() => undefined)
  return run
}

interface Envelope<T> {
  code?: number
  message?: string
  data?: T
}

export interface BilibiliCreatorProfile {
  mid: number
  name: string
  sign: string
  face: string
  following: number
  follower: number
  videoCount: number
}

export interface BilibiliPublication {
  bvid: string
  title: string
  description: string
  pic: string
  created: number
}

export interface BilibiliPage {
  cid: number
  page: number
  part: string
}

export interface BilibiliVideoDetail {
  bvid: string
  aid: number
  title: string
  desc: string
  pic: string
  pubdate: number
  ownerMid: number
  ownerName: string
  ownerFace: string
  pages: BilibiliPage[]
}

export interface BilibiliPlayUrl {
  dash?: DashPayload
  durl?: { url?: string }[]
}

let wbiCache: { imgKey: string; subKey: string; at: number } | null = null

export function bilibiliCookie(): string {
  return (getSetting('bilibili_cookie') || '').trim()
}

export function hasBilibiliLogin(cookie = bilibiliCookie()): boolean {
  return /(?:^|;\s*)SESSDATA=/.test(cookie)
}

export function clearWbiCache(): void {
  wbiCache = null
}

export async function resolveBilibiliAddress(input: string): Promise<string> {
  const extracted = extractCreatorLink(input)?.url ?? input.trim()
  if (!/^https?:\/\/(?:www\.)?(?:b23\.tv|bili2233\.cn)\//i.test(extracted)) return extracted
  const response = await net.fetch(extracted, {
    headers: { 'User-Agent': BILIBILI_USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000)
  })
  return response.url || extracted
}

export async function fetchCreatorProfile(mid: number): Promise<BilibiliCreatorProfile> {
  const referer = `https://space.bilibili.com/${mid}`
  const info = await biliData<{ mid?: number; name?: string; sign?: string; face?: string }>(
    `https://api.bilibili.com/x/space/wbi/acc/info?${await signedQuery({ mid })}`,
    referer
  )
  const stat = await biliData<{ following?: number; follower?: number }>(
    `https://api.bilibili.com/x/relation/stat?vmid=${mid}`,
    referer
  )
  const publications = await fetchPublicationPage(mid, 1)
  return {
    mid: info.mid || mid,
    name: (info.name || '').trim(),
    sign: info.sign || '',
    face: normalizeAssetUrl(info.face || ''),
    following: stat.following || 0,
    follower: stat.follower || 0,
    videoCount: publications.total
  }
}

export async function fetchPublicationPage(
  mid: number,
  page: number
): Promise<{ videos: BilibiliPublication[]; total: number; pageSize: number }> {
  const query = await signedQuery({
    mid,
    pn: page,
    ps: 30,
    order: 'pubdate',
    tid: 0,
    keyword: ''
  })
  const data = await biliData<{
    list?: { vlist?: Array<Record<string, unknown>> }
    page?: { count?: number; ps?: number }
  }>(
    `https://api.bilibili.com/x/space/wbi/arc/search?${query}`,
    `https://space.bilibili.com/${mid}`
  )
  const videos = (data.list?.vlist ?? [])
    .map((item) => ({
      bvid: String(item.bvid || ''),
      title: String(item.title || ''),
      description: String(item.description || ''),
      pic: normalizeAssetUrl(String(item.pic || '')),
      created: Number(item.created) || 0
    }))
    .filter((item) => /^BV[0-9A-Za-z]{10}$/.test(item.bvid))
  return {
    videos,
    total: Number(data.page?.count) || 0,
    pageSize: Number(data.page?.ps) || 30
  }
}

export async function fetchVideoDetail(input: {
  bvid?: string
  aid?: number
}): Promise<BilibiliVideoDetail> {
  const query = input.bvid ? `bvid=${encodeURIComponent(input.bvid)}` : `aid=${input.aid ?? ''}`
  const data = await biliData<{
    bvid?: string
    aid?: number
    title?: string
    desc?: string
    pic?: string
    pubdate?: number
    owner?: { mid?: number; name?: string; face?: string }
    pages?: Array<{ cid?: number; page?: number; part?: string }>
  }>(`https://api.bilibili.com/x/web-interface/view?${query}`)
  const pages = (data.pages ?? [])
    .map((page) => ({
      cid: Number(page.cid) || 0,
      page: Number(page.page) || 0,
      part: page.part || ''
    }))
    .filter((page) => page.cid > 0 && page.page > 0)
  if (!data.bvid || pages.length === 0) {
    throw new Error('作品详情里没有可下载的分 P')
  }
  return {
    bvid: data.bvid,
    aid: Number(data.aid) || 0,
    title: data.title || '',
    desc: data.desc || '',
    pic: normalizeAssetUrl(data.pic || ''),
    pubdate: Number(data.pubdate) || 0,
    ownerMid: Number(data.owner?.mid) || 0,
    ownerName: data.owner?.name || '',
    ownerFace: normalizeAssetUrl(data.owner?.face || ''),
    pages
  }
}

/**
 * fnval=4048、fourk=1，与 downkyicore GetVideoPlayUrlAsync 相同。
 * quality 为 0（最高可用）时按 8K 请求，返回里会带上账号能拿到的全部档位。
 */
export async function fetchPlayUrl(
  bvid: string,
  cid: number,
  quality: number
): Promise<BilibiliPlayUrl> {
  const query = await signedQuery({
    fourk: 1,
    fnver: 0,
    fnval: 4048,
    cid,
    qn: quality > 0 ? quality : 127,
    bvid
  })
  return biliData<BilibiliPlayUrl>(
    `https://api.bilibili.com/x/player/wbi/playurl?${query}`,
    `https://www.bilibili.com/video/${bvid}`
  )
}

export async function fetchSubtitleTracks(
  bvid: string,
  cid: number
): Promise<{ url: string; lan: string }[]> {
  try {
    const data = await biliData<{
      subtitle?: { subtitles?: Array<{ subtitle_url?: string; lan?: string }> }
    }>(
      `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${cid}`,
      `https://www.bilibili.com/video/${bvid}`
    )
    return (data.subtitle?.subtitles ?? [])
      .map((track) => ({
        url: normalizeAssetUrl(track.subtitle_url || ''),
        lan: track.lan || 'zh'
      }))
      .filter((track) => track.url)
  } catch (error) {
    console.warn(`[Bilibili] 字幕列表获取失败 ${bvid}:`, error)
    return []
  }
}

export async function biliData<T>(url: string, referer = 'https://www.bilibili.com'): Promise<T> {
  const body = (await biliRequest(url, referer)) as Envelope<T>
  if (body.code !== undefined && RISK_CODES.has(body.code)) markRiskControl(String(body.code))
  if (body.code !== 0 || body.data == null) {
    throw new Error(body.message || `哔哩哔哩接口错误 ${body.code ?? 'unknown'}`)
  }
  return body.data
}

export function bilibiliHeaders(referer: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': BILIBILI_USER_AGENT,
    // 只带来源域名：net.fetch 默认按 strict-origin-when-cross-origin 校验，
    // 跨域带完整路径的 Referer 会被 Chromium 直接取消（ERR_BLOCKED_BY_CLIENT）。
    // 浏览器里发给 B 站的也是这个形式
    Referer: `${new URL(referer).origin}/`,
    Origin: 'https://www.bilibili.com'
  }
  const cookie = bilibiliCookie()
  if (cookie) headers.Cookie = cookie
  return headers
}

function biliRequest(url: string, referer: string): Promise<unknown> {
  return withApiThrottle(async () => {
    const response = await net.fetch(url, {
      headers: bilibiliHeaders(referer),
      signal: AbortSignal.timeout(20_000)
    })
    if (response.status === 412) markRiskControl('HTTP 412')
    if (!response.ok) throw new Error(`哔哩哔哩接口 HTTP ${response.status}`)
    return response.json()
  })
}

async function signedQuery(parameters: Record<string, string | number>): Promise<string> {
  const keys = await getWbiKeys()
  const payload: Record<string, string | number> = { ...parameters }
  if (!hasBilibiliLogin()) Object.assign(payload, ANON_DM_FIELDS)
  return wbiQuery(encodeWbi(payload, keys.imgKey, keys.subKey, Math.floor(Date.now() / 1000)))
}

async function getWbiKeys(): Promise<{ imgKey: string; subKey: string }> {
  if (wbiCache && Date.now() - wbiCache.at < 10 * 60_000) {
    return { imgKey: wbiCache.imgKey, subKey: wbiCache.subKey }
  }
  const body = (await biliRequest(
    'https://api.bilibili.com/x/web-interface/nav',
    'https://www.bilibili.com'
  )) as Envelope<{ wbi_img?: { img_url?: string; sub_url?: string } }>
  const imgKey = keyFromUrl(body.data?.wbi_img?.img_url)
  const subKey = keyFromUrl(body.data?.wbi_img?.sub_url)
  if (!imgKey || !subKey) throw new Error('无法获取哔哩哔哩签名参数，请检查网络或重新登录')
  wbiCache = { imgKey, subKey, at: Date.now() }
  return { imgKey, subKey }
}

function keyFromUrl(url: string | undefined): string {
  const name = url?.split('/').pop()?.split('.')[0] ?? ''
  return /^[A-Za-z0-9]{32}$/.test(name) ? name : ''
}

export function normalizeAssetUrl(url: string): string {
  if (!url) return ''
  if (url.startsWith('//')) return `https:${url}`
  return url.replace(/^http:\/\//i, 'https://')
}
