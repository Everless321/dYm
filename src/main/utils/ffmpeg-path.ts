import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

// 打包时 resources/ffmpeg 通过 electron-builder extraResources 复制到 <Resources>/ffmpeg/；
// 开发时用仓库里的 resources/ffmpeg/（由 scripts/download-ffmpeg.mjs 拉取）。
// 需 ffmpeg ≥7.0：抖音直播原画用非标准「FLV codec id 12 = HEVC」，旧版无法解封装。
const exe = process.platform === 'win32' ? '.exe' : ''

function resolveBin(name: string): string {
  const file = `${name}${exe}`
  const candidates = [
    join(process.resourcesPath, 'ffmpeg', file), // 打包后 extraResources
    join(app.getAppPath(), 'resources', 'ffmpeg', file), // 开发
    join(process.cwd(), 'resources', 'ffmpeg', file) // 兜底
  ]
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}

export const ffmpegPath = resolveBin('ffmpeg')
export const ffprobePath = resolveBin('ffprobe')
