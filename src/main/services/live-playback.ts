import { existsSync, readFileSync } from 'fs'
import { toUrlPath } from './media'
import { getLiveRecordById } from '../database'
import { isConverting } from './live-convert'
import { danmakuPathFor, type DanmakuLine } from './live-danmaku'

export interface LivePlaybackInfo {
  videoUrl: string
  title: string | null
  nickname: string | null
  quality: string | null
  coverPath: string | null
  filePath: string | null
}

/**
 * 为回放准备可原生播放的视频 URL。
 * 录制结束后由 live-convert 自动转成带 moov 索引的 MP4，这里只放行已转换完成的记录：
 * 录制中/转换中/未转换的一律拒绝（原始 FLV 无索引，浏览器播不了也 seek 不了）。
 */
export async function preparePlayback(recordId: number): Promise<LivePlaybackInfo> {
  const rec = getLiveRecordById(recordId)
  if (!rec) throw new Error('记录不存在')
  if (rec.status === 'recording') throw new Error('录制进行中，结束并转换完成后才能观看')
  if (isConverting(recordId)) throw new Error('正在转换为可播放格式，转换完成后即可观看')
  if (!rec.file_path || !existsSync(rec.file_path)) throw new Error('视频文件不存在')
  if (!rec.file_path.toLowerCase().endsWith('.mp4')) {
    throw new Error('该录制尚未完成转换，转换完成后才能观看')
  }

  return {
    videoUrl: `local://file${toUrlPath(rec.file_path)}`,
    title: rec.title,
    nickname: rec.nickname,
    quality: rec.quality,
    coverPath: rec.cover_path,
    filePath: rec.file_path
  }
}

/**
 * 读取该场录制的弹幕 sidecar。首行是元信息，其余每行一条事件（含相对时间 t）。
 * 无弹幕文件（旧录制、或当时抓取失败）返回空数组。
 */
export function getDanmaku(recordId: number): DanmakuLine[] {
  const rec = getLiveRecordById(recordId)
  if (!rec?.file_path) return []
  const path = danmakuPathFor(rec.file_path)
  if (!existsSync(path)) return []

  try {
    const lines = readFileSync(path, 'utf-8').split('\n')
    const events: DanmakuLine[] = []
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        // 跳过首行元信息（无 t 字段）
        if (typeof parsed.t !== 'number') continue
        events.push(parsed as DanmakuLine)
      } catch {
        // 录制中断可能留下半行，跳过
      }
    }
    events.sort((a, b) => a.t - b.t)
    return events
  } catch (error) {
    console.error('[LivePlayback] 读取弹幕失败:', error)
    return []
  }
}
