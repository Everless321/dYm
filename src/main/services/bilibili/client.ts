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

/** fnval=4048、fourk=1，与 downkyicore GetVideoPlayUrlAsync 相同。 */
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
    qn: quality,
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
  if (body.code !== 0 || body.data == null) {
    throw new Error(body.message || `哔哩哔哩接口错误 ${body.code ?? 'unknown'}`)
  }
  return body.data
}

export function bilibiliHeaders(referer: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': BILIBILI_USER_AGENT,
    Referer: referer,
    Origin: 'https://www.bilibili.com'
  }
  const cookie = bilibiliCookie()
  if (cookie) headers.Cookie = cookie
  return headers
}

async function biliRequest(url: string, referer: string): Promise<unknown> {
  const response = await net.fetch(url, {
    headers: bilibiliHeaders(referer),
    signal: AbortSignal.timeout(20_000)
  })
  if (!response.ok) throw new Error(`哔哩哔哩接口 HTTP ${response.status}`)
  return response.json()
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
