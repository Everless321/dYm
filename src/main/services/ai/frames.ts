import { app } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync } from 'fs'
import { mkdir, readFile, rm } from 'fs/promises'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { cpus } from 'os'
import { ffmpegPath, ffprobePath } from '../../utils/ffmpeg-path'
import { getDownloadPath } from '../media'
import type { VisionImage } from './types'

const execFileAsync = promisify(execFile)

// 每个视频只跑一个短生命周期进程，可以按核数放宽
const MAX_FFMPEG_CONCURRENCY = Math.min(4, Math.max(2, cpus().length - 2))
let ffmpegRunning = 0
const ffmpegQueue: Array<() => void> = []

async function acquireFfmpegSlot(): Promise<void> {
  if (ffmpegRunning < MAX_FFMPEG_CONCURRENCY) {
    ffmpegRunning++
    return
  }
  await new Promise<void>((resolve) => {
    ffmpegQueue.push(() => {
      ffmpegRunning++
      resolve()
    })
  })
}

function releaseFfmpegSlot(): void {
  ffmpegRunning--
  ffmpegQueue.shift()?.()
}

export function findMediaFolder(secUid: string, folderName: string): string | null {
  const basePath = join(getDownloadPath(), secUid)
  if (!existsSync(basePath)) return null
  const exactPath = join(basePath, folderName)
  if (existsSync(exactPath)) return exactPath
  try {
    for (const folder of readdirSync(basePath)) {
      if (folder.endsWith(folderName) || folder.includes(`_${folderName}`)) {
        return join(basePath, folder)
      }
    }
  } catch {
    return null
  }
  return null
}

async function probeDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    ffprobePath,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      videoPath
    ],
    { timeout: 20_000, maxBuffer: 1 << 16 }
  )
  const duration = parseFloat(stdout.trim())
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长')
  return duration
}

function mimeOf(file: string): VisionImage['mime'] {
  const ext = file.split('.').pop()?.toLowerCase()
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
}

/**
 * 单个 ffmpeg 进程一次性抽全部帧：同一文件作为 N 路输入，各路 -ss 输入前 seek 后 map 一帧。
 * 帧数按时长自适应：短视频每 3 秒最多一帧，避免 5 秒视频抽出 4 张几乎一样的图白白花 token。
 */
export async function extractVideoFrames(
  videoPath: string,
  maxFrames: number
): Promise<VisionImage[]> {
  if (!existsSync(videoPath)) throw new Error(`视频文件不存在：${videoPath}`)
  const duration = await probeDuration(videoPath)
  const count = Math.max(1, Math.min(maxFrames, Math.ceil(duration / 3)))
  const interval = duration / (count + 1)

  const tempDir = join(app.getPath('temp'), 'dym-frames', randomUUID())
  await mkdir(tempDir, { recursive: true })
  try {
    const framePaths = Array.from({ length: count }, (_, i) => join(tempDir, `frame_${i + 1}.jpg`))
    const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y']
    for (let i = 1; i <= count; i++) {
      // 每路解码限 2 线程：N 路并行解码不限线程时 4K 视频 CPU 峰值可达 800%+
      args.push('-threads', '2', '-ss', (interval * i).toFixed(2), '-i', videoPath)
    }
    framePaths.forEach((framePath, i) => {
      // 缩到最宽 1280：4K 帧 JPEG 2-3MB、base64 后每条作品十几 MB 塞进请求体，模型侧本来也会下采样
      args.push(
        '-map',
        `${i}:v:0`,
        '-frames:v',
        '1',
        '-vf',
        "scale='min(1280,iw)':-2",
        '-q:v',
        '3',
        framePath
      )
    })

    await acquireFfmpegSlot()
    try {
      await execFileAsync(ffmpegPath, args, { timeout: 60_000, maxBuffer: 1 << 20 })
    } catch (err) {
      // 个别时间点可能提取失败，只要有帧产出就继续
      console.warn('[AI] ffmpeg 抽帧报错（若仍有帧产出则继续）:', (err as Error).message)
    } finally {
      releaseFfmpegSlot()
    }

    const images: VisionImage[] = []
    for (const path of framePaths) {
      if (!existsSync(path)) continue
      images.push({ mime: 'image/jpeg', data: await readFile(path) })
    }
    if (!images.length) throw new Error('未能从视频中提取任何画面')
    return images
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** 读取作品的图片输入：视频抽帧，图集取前 N 张图 */
export async function loadPostImages(
  post: { sec_uid: string; folder_name: string; aweme_type: number },
  maxImages: number
): Promise<VisionImage[]> {
  const mediaFolder = findMediaFolder(post.sec_uid, post.folder_name)
  if (!mediaFolder) throw new Error('本地媒体目录不存在（可能已被删除或迁移）')
  const files = readdirSync(mediaFolder)

  if (post.aweme_type === 68) {
    const imageFiles = files
      .filter((f) => /\.(webp|jpg|jpeg|png)$/i.test(f) && !f.includes('_cover'))
      .sort()
      .slice(0, Math.max(1, Math.min(10, maxImages * 2)))
    if (!imageFiles.length) throw new Error('图集目录里没有图片文件')
    const images: VisionImage[] = []
    for (const file of imageFiles) {
      images.push({ mime: mimeOf(file), data: await readFile(join(mediaFolder, file)) })
    }
    return images
  }

  const videoFile = files.find((f) => /\.(mp4|mov|avi|mkv)$/i.test(f))
  if (!videoFile) throw new Error('目录里没有视频文件')
  return extractVideoFrames(join(mediaFolder, videoFile), maxImages)
}
