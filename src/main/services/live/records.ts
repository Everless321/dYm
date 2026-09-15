import { rmSync } from 'fs'
import { deleteLiveRecord, getLiveRecordById } from '../../database'
import { isConverting } from './convert'
import { danmakuPathFor } from './danmaku'

export interface DeleteLiveRecordsResult {
  deleted: number
  /** 空间释放估算：按库里记录的 file_size 累加（仅 deleteFiles 时有意义） */
  freedBytes: number
  failed: { id: number; reason: string }[]
}

/**
 * 一条录制在磁盘上可能留下的全部文件：
 * 视频本体（flv 或转封装后的 mp4，二者只会存在一个，但都试着删）、
 * 转封装中断残留的 .part.mp4、弹幕 sidecar、封面图。
 */
function filesOfRecord(rec: { file_path: string | null; cover_path: string | null }): string[] {
  const paths = new Set<string>()
  if (rec.file_path) {
    const base = rec.file_path.replace(/\.(flv|mp4)$/i, '')
    paths.add(rec.file_path)
    paths.add(`${base}.flv`)
    paths.add(`${base}.mp4`)
    paths.add(`${base}.mp4.part.mp4`)
    paths.add(danmakuPathFor(rec.file_path))
  }
  if (rec.cover_path) paths.add(rec.cover_path)
  return [...paths]
}

/**
 * 批量删除录制记录。录制中 / 转封装中的记录会被拒绝（文件仍被 ffmpeg 持有），
 * 其余逐条删库；deleteFiles 为真时连同磁盘文件一起清掉，单个文件删不掉只记日志不影响删库。
 */
export function deleteLiveRecords(ids: number[], deleteFiles: boolean): DeleteLiveRecordsResult {
  const result: DeleteLiveRecordsResult = { deleted: 0, freedBytes: 0, failed: [] }

  for (const id of ids) {
    const rec = getLiveRecordById(id)
    if (!rec) {
      result.failed.push({ id, reason: '记录不存在' })
      continue
    }
    if (rec.status === 'recording') {
      result.failed.push({ id, reason: '录制进行中，请先停止录制' })
      continue
    }
    if (isConverting(id)) {
      result.failed.push({ id, reason: '正在转换为可播放格式，请稍后再删' })
      continue
    }

    if (deleteFiles) {
      for (const path of filesOfRecord(rec)) {
        try {
          rmSync(path, { force: true })
        } catch (error) {
          console.error(`[Live] 删除文件失败 ${path}:`, error)
        }
      }
      result.freedBytes += rec.file_size || 0
    }

    deleteLiveRecord(id)
    result.deleted += 1
  }

  return result
}
