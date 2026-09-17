import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, rm } from 'fs/promises'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { cpus } from 'os'
import { ffmpegPath, ffprobePath } from '../../utils/ffmpeg-path'

const execFileAsync = promisify(execFile)

/**
 * 分析流程里所有 ffmpeg / ffprobe 调用的统一入口：并发槽位、超时、临时目录。
 * 抽帧、音频切片、探测都走这里，避免 N 个作品并行时同时起几十个解码进程。
 */

const MAX_FFMPEG_CONCURRENCY = Math.min(4, Math.max(2, cpus().length - 2))
let ffmpegRunning = 0
const ffmpegQueue: Array<() => void> = []

async function acquireSlot(): Promise<void> {
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

function releaseSlot(): void {
  ffmpegRunning--
  ffmpegQueue.shift()?.()
}

export interface FfmpegRunResult {
  stdout: string
  stderr: string
}

/** 跑一次 ffmpeg；非零退出抛错（错误里带 stderr 末尾），成功返回 stderr 供解析 showinfo / volumedetect */
export async function runFfmpeg(
  args: string[],
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<FfmpegRunResult> {
  options.signal?.throwIfAborted()
  await acquireSlot()
  try {
    const { stdout, stderr } = await execFileAsync(
      ffmpegPath,
      ['-hide_banner', '-nostdin', '-y', ...args],
      {
        timeout: options.timeoutMs ?? 120_000,
        maxBuffer: 8 << 20,
        signal: options.signal,
        encoding: 'utf8'
      }
    )
    return { stdout, stderr }
  } catch (error) {
    const err = error as Error & { stderr?: string; code?: unknown }
    if (options.signal?.aborted) throw options.signal.reason ?? err
    const tail = (err.stderr || '').trim().split('\n').slice(-3).join(' ').slice(0, 300)
    throw new Error(`ffmpeg 执行失败${tail ? `：${tail}` : `（${err.message}）`}`)
  } finally {
    releaseSlot()
  }
}

export async function runFfprobe(args: string[], timeoutMs = 20_000): Promise<string> {
  const { stdout } = await execFileAsync(ffprobePath, ['-v', 'error', ...args], {
    timeout: timeoutMs,
    maxBuffer: 1 << 20,
    encoding: 'utf8'
  })
  return stdout
}

export interface MediaInfo {
  duration: number
  width: number
  height: number
  hasAudio: boolean
}

/** 一次 ffprobe 读齐时长 / 分辨率 / 有无音轨 */
export async function probeMedia(videoPath: string): Promise<MediaInfo> {
  if (!existsSync(videoPath)) throw new Error(`视频文件不存在：${videoPath}`)
  const raw = await runFfprobe([
    '-show_entries',
    'format=duration:stream=codec_type,width,height,duration',
    '-of',
    'json',
    videoPath
  ])
  const data = JSON.parse(raw) as {
    format?: { duration?: string }
    streams?: { codec_type?: string; width?: number; height?: number; duration?: string }[]
  }
  const video = data.streams?.find((s) => s.codec_type === 'video')
  const audio = data.streams?.find((s) => s.codec_type === 'audio')
  let duration = parseFloat(data.format?.duration ?? '')
  if (!Number.isFinite(duration) || duration <= 0) duration = parseFloat(video?.duration ?? '')
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长')
  return {
    duration,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasAudio: !!audio
  }
}

/** 分析用临时目录，用完必须 removeTempDir */
export async function makeTempDir(prefix: string): Promise<string> {
  const dir = join(app.getPath('temp'), 'dym-analysis', `${prefix}-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  return dir
}

export async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
}

/** 是否有 libmp3lame：没有的话音频切片退回 wav */
let mp3EncoderChecked: Promise<boolean> | null = null
export function hasMp3Encoder(): Promise<boolean> {
  if (!mp3EncoderChecked) {
    mp3EncoderChecked = execFileAsync(ffmpegPath, ['-hide_banner', '-encoders'], {
      timeout: 15_000,
      maxBuffer: 1 << 20,
      encoding: 'utf8'
    })
      .then(({ stdout }) => /\blibmp3lame\b/.test(stdout))
      .catch(() => false)
  }
  return mp3EncoderChecked
}
