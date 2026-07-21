import { net } from 'electron'
import { writeFileSync } from 'fs'
import { toUrlPath } from './media'

/**
 * 下载直播封面到本地 `destPath`（与录制的 .flv 同目录、同名 .jpg）。
 * 在主进程用 net.fetch 请求，绕开渲染端 CSP / 抖音防盗链，且避免 CDN 链接过期后失效。
 * 返回 local:// 协议可用的路径（toUrlPath 形式）；失败返回 null
 * （不抛出，封面只是锦上添花，不应影响录制主流程）。
 */
export async function downloadLiveCover(
  coverUrl: string,
  destPath: string
): Promise<string | null> {
  if (!coverUrl || !/^https?:\/\//i.test(coverUrl)) return null

  try {
    const res = await net.fetch(coverUrl)
    if (!res.ok) {
      console.warn(`[LiveCover] download failed ${res.status}`)
      return null
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length === 0) return null

    writeFileSync(destPath, buffer)
    console.log(`[LiveCover] saved: ${destPath}`)
    return toUrlPath(destPath)
  } catch (error) {
    console.error(`[LiveCover] download error:`, error)
    return null
  }
}
