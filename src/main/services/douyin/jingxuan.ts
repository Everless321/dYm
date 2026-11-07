import { getSetting } from '../../database'

/**
 * 实验特性「精选接口下载视频」。
 *
 * 精选页（jingxuan.douyin.com，手机 UA）不需要 Cookie 就能拿到作品的 video_id，
 * 再用 aweme.snssdk.com 的 play 接口取 302 跳转地址，就是原画文件。
 * 两个接口都不需要 Cookie 和签名，风控概率更低、解析更快，但随时可能失效，
 * 所以任何一步失败都返回 null，调用方继续用 polydl 的原地址。
 */

const JINGXUAN_VIDEO_SETTING = 'jingxuan_video_download'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const TIMEOUT_MS = 10_000

/** 精选页 HTML 里，本作品 video_model（转义过的 JSON 字符串）中的 video_id */
export function extractVideoId(html: string, awemeId: string): string | null {
  const start = html.indexOf(`"gid":"${awemeId}","video_model":`)
  if (start < 0) return null
  const match = /\\"video_id\\":\\"([0-9a-z]+)\\"/.exec(html.slice(start, start + 2000))
  return match ? match[1] : null
}

/** 精选页 → video_id → play 接口 302 的原画地址；关闭开关或任一步失败返回 null */
export async function resolveOriginalVideoUrl(awemeId: string): Promise<string | null> {
  if (getSetting(JINGXUAN_VIDEO_SETTING) !== 'true') return null
  try {
    const page = await fetch(`https://jingxuan.douyin.com/m/video/${awemeId}?app=yumme`, {
      headers: { 'User-Agent': MOBILE_UA },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!page.ok) throw new Error(`精选页 HTTP ${page.status}`)
    const videoId = extractVideoId(await page.text(), awemeId)
    if (!videoId) throw new Error('精选页里没有 video_id（图集或作品不可见）')

    const play = await fetch(
      `https://aweme.snssdk.com/aweme/v1/play/?video_id=${videoId}&ratio=default&line=0`,
      {
        headers: { 'User-Agent': MOBILE_UA },
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS)
      }
    )
    const location = play.headers.get('location')
    if (play.status !== 302 || !location) throw new Error(`play 接口 HTTP ${play.status}`)
    return location
  } catch (error) {
    console.warn(`[Jingxuan] ${awemeId} 取原画地址失败，回退原地址:`, (error as Error).message)
    return null
  }
}

/**
 * 视频作品换成原画地址的副本，给 polydl 第一次下载用；
 * 图集、关闭开关或取地址失败时原样返回。下载校验失败后的重试仍用原数据，即回退。
 */
export async function withOriginalVideo<T extends { awemeId?: string; awemeType?: number }>(
  awemeData: T
): Promise<T> {
  if (!awemeData.awemeId || awemeData.awemeType === 68) return awemeData
  const url = await resolveOriginalVideoUrl(awemeData.awemeId)
  return url ? { ...awemeData, videoPlayAddr: [url] } : awemeData
}
