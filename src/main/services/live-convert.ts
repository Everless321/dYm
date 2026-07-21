import { spawn, execFile } from 'child_process'
import { BrowserWindow } from 'electron'
import { existsSync, renameSync, rmSync, statSync } from 'fs'
import { ffmpegPath, ffprobePath } from '../utils/ffmpeg-path'
import { getLiveRecords, getLiveRecordById, updateLiveRecord } from '../database'
import type { LiveProgress } from './live-recorder'

/**
 * 录制收尾转换：FLV -> MP4（视频 copy + 音频重编码 + faststart）。
 * 录制期间保持 FLV（追加式、抗中断），结束后立刻转成可直接播放的 MP4，
 * 成功后回写 file_path 并删除 FLV。回放打开即秒开，不再按需转封装。
 */

// 转换中/排队中的记录 id（含队列中未开始的）；UI 据此显示「转换中…」
const convertingIds = new Set<number>()

// 串行队列：启动补扫可能一次入队多条，逐条转，避免多路 ffmpeg 抢 CPU/磁盘
let queueTail: Promise<void> = Promise.resolve()

export function getConvertingIds(): number[] {
  return Array.from(convertingIds)
}

export function isConverting(recordId: number): boolean {
  return convertingIds.has(recordId)
}

function broadcast(progress: LiveProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('live:progress', progress)
  }
}

function progressOf(recordId: number, status: LiveProgress['status'], message: string): void {
  const rec = getLiveRecordById(recordId)
  broadcast({
    userId: rec?.user_id ?? 0,
    recordId,
    nickname: rec?.nickname || '',
    status,
    roomId: rec?.room_id ?? null,
    title: rec?.title ?? null,
    filePath: rec?.file_path ?? null,
    message
  })
}

/** 录制结束后调用：把该记录排入转换队列（无可转文件时静默跳过） */
export function enqueueConvert(recordId: number): void {
  const rec = getLiveRecordById(recordId)
  const src = rec?.file_path
  if (!src || !src.toLowerCase().endsWith('.flv') || !existsSync(src)) return
  if (convertingIds.has(recordId)) return

  convertingIds.add(recordId)
  queueTail = queueTail.then(async () => {
    try {
      progressOf(recordId, 'converting', '正在转换为可播放格式…')
      await convertRecord(recordId)
      progressOf(recordId, 'converted', '转换完成，可以观看了')
    } catch (err) {
      console.error(`[LiveConvert] 记录 ${recordId} 转换失败:`, err)
      progressOf(recordId, 'convert-failed', `转换失败：${(err as Error).message}`)
    } finally {
      convertingIds.delete(recordId)
    }
  })
}

/** 应用启动时补扫：历史/异常退出遗留的未转换 FLV 全部入队 */
export function sweepUnconverted(): void {
  for (const rec of getLiveRecords(500)) {
    if (rec.status === 'recording') continue
    if (rec.file_path?.toLowerCase().endsWith('.flv') && existsSync(rec.file_path)) {
      enqueueConvert(rec.id)
    }
  }
}

async function convertRecord(recordId: number): Promise<void> {
  // 队列等待期间记录可能已被删除，重新取
  const rec = getLiveRecordById(recordId)
  const src = rec?.file_path
  if (!src || !existsSync(src)) return

  const dest = src.replace(/\.flv$/i, '.mp4')
  await remuxAtomic(src, dest)

  updateLiveRecord(recordId, { file_path: dest, file_size: statSync(dest).size })
  rmSync(src, { force: true })
}

/**
 * 原子转封装：先写 .part 临时文件，成功后 rename 到最终路径。
 * 目标文件要么不存在、要么完整——中途退出/失败不会留下半截 mp4 被误当作可播放文件。
 */
async function remuxAtomic(src: string, dest: string): Promise<void> {
  const part = `${dest}.part.mp4`
  try {
    await remux(src, part)
    renameSync(part, dest)
  } catch (err) {
    rmSync(part, { force: true })
    throw err
  }
}

// 探测视频流真实编码（不能靠画质档位猜：抖音「原画」多为 H.264，个别才是 HEVC）
function probeVideoCodec(src: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      ffprobePath,
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name',
        '-of',
        'csv=p=0',
        src
      ],
      (err, stdout) => resolve(err ? '' : stdout.trim().toLowerCase())
    )
  })
}

/**
 * FLV -> MP4 转封装（视频无损 copy，音频重编码）。
 * - `+faststart`：把 moov 移到文件头，Chromium 原生 <video> 才能定位并播放。
 * - 音频重编码为全新 AAC：直播流里 copy 过来的 AAC 虽然合规（裸帧、esds 齐全），
 *   Chromium 解码器仍会拒收（Failed to send audio packet）。重编码很便宜
 *   （200s 素材约 1.5s），换来任何解码器都能吃的干净音轨。视频仍 copy，不牺牲画质与速度。
 * - 仅当真为 HEVC 时打 hvc1 tag；对 H.264 打 hvc1 会导致 ffmpeg 失败/文件损坏。
 */
async function remux(src: string, dest: string): Promise<void> {
  const codec = await probeVideoCodec(src)
  const args = ['-y', '-i', src, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k']
  if (codec === 'hevc' || codec === 'h265') {
    args.push('-tag:v', 'hvc1')
  }
  args.push('-movflags', '+faststart', dest)

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args)
    let stderr = ''
    proc.stderr?.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`转封装失败 (ffmpeg 退出码 ${code})：${stderr.slice(-300)}`))
    })
  })
}
