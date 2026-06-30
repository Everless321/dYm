import { net } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getDownloadPath, toUrlPath } from './media'

// 抖音 sec_uid 仅含字母/数字/下划线/连字符；用作路径前先校验，防止路径穿越
const SEC_UID_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * 下载用户头像到本地 `{下载目录}/{sec_uid}/avatar.jpg`。
 * 在主进程用 net.fetch 请求，不受渲染端 CSP / 抖音防盗链限制。
 * 返回 local:// 协议可用的路径（toUrlPath 形式）；失败返回 null
 * （不抛出，调用方降级用远程链接）。
 */
export async function downloadAvatar(secUid: string, avatarUrl: string): Promise<string | null> {
  if (!avatarUrl || !/^https?:\/\//i.test(avatarUrl)) return null
  if (!SEC_UID_PATTERN.test(secUid)) {
    console.warn(`[Avatar] rejected invalid secUid: ${secUid}`)
    return null
  }

  try {
    const res = await net.fetch(avatarUrl)
    if (!res.ok) {
      console.warn(`[Avatar] download failed ${res.status} for ${secUid}`)
      return null
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length === 0) return null

    const userDir = join(getDownloadPath(), secUid)
    mkdirSync(userDir, { recursive: true })
    const filePath = join(userDir, 'avatar.jpg')
    writeFileSync(filePath, buffer)
    console.log(`[Avatar] saved: ${filePath}`)
    // 返回 local:// 协议可用的 URL 形式路径（Windows 下需前缀 /），与封面图一致
    return toUrlPath(filePath)
  } catch (error) {
    console.error(`[Avatar] download error for ${secUid}:`, error)
    return null
  }
}
