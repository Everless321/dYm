import { createWriteStream } from 'fs'
import { getDouyinHandler } from './douyin'

// 只记录这三类：聊天 / 礼物 / 进场。点赞、房间统计等刷屏事件丢弃，避免文件膨胀。
const RECORDED_TYPES = new Set(['chat', 'gift', 'member'])

export interface DanmakuRecorder {
  stop: () => void
}

/** 落盘的弹幕行（相对时间 t，单位毫秒，相对录制起点） */
export interface DanmakuLine {
  t: number
  type: 'chat' | 'gift' | 'member'
  name: string
  text?: string
  gift?: string
  count?: number
}

/** 文件首行的元信息 */
export interface DanmakuMetaLine {
  v: number
  startedAt: number
  roomId: string
}

/**
 * 录制直播弹幕到 sidecar 文件（每行一条 JSON）。
 *
 * 时间对齐：首行写入 startedAt（录制起点的墙钟 epoch ms），
 * 之后每条事件记相对偏移 t = receivedAt - startedAt。
 * 回放时 t/1000 即为对应的视频秒数（再叠加用户可调的延迟补偿）。
 *
 * 弹幕流失败不抛出、不影响录像主流程——最坏情况只是没有弹幕。
 */
export function startDanmakuRecording(
  roomId: string,
  filePath: string,
  startedAt: number
): DanmakuRecorder {
  const controller = new AbortController()
  const out = createWriteStream(filePath, { flags: 'a' })

  const meta: DanmakuMetaLine = { v: 1, startedAt, roomId }
  out.write(`${JSON.stringify(meta)}\n`)

  void (async () => {
    const handler = getDouyinHandler()
    if (!handler) {
      out.end()
      return
    }
    let count = 0
    try {
      for await (const ev of handler.fetchLiveDanmaku(roomId, { signal: controller.signal })) {
        if (!RECORDED_TYPES.has(ev.type)) continue

        const t = ev.receivedAt - startedAt
        let line: DanmakuLine | null = null
        if (ev.type === 'chat') {
          line = { t, type: 'chat', name: ev.user.nickname || '', text: ev.content }
        } else if (ev.type === 'gift') {
          line = {
            t,
            type: 'gift',
            name: ev.user.nickname || '',
            gift: ev.giftName || '礼物',
            count: ev.totalCount
          }
        } else if (ev.type === 'member') {
          line = { t, type: 'member', name: ev.user.nickname || '' }
        }
        if (line) {
          out.write(`${JSON.stringify(line)}\n`)
          count++
        }
      }
    } catch (error) {
      // 直播结束、连接中断、主动 abort 都会走到这里，均属正常收尾
      console.log(`[Danmaku] 房间 ${roomId} 弹幕流结束：${(error as Error).message}`)
    } finally {
      console.log(`[Danmaku] 房间 ${roomId} 共记录 ${count} 条`)
      out.end()
    }
  })()

  return { stop: () => controller.abort() }
}

/** 由录像文件路径推导弹幕 sidecar 路径（与录像同名同目录；转换后 .flv 会变 .mp4） */
export function danmakuPathFor(videoPath: string): string {
  return videoPath.replace(/\.(flv|mp4)$/i, '') + '.danmaku.jsonl'
}
