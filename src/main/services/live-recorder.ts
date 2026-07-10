import { spawn, type ChildProcess } from 'child_process'
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { mkdirSync, statSync } from 'fs'
import { ffmpegPath } from '../utils/ffmpeg-path'
import { track } from './telemetry'
import { getDouyinHandler } from './douyin'
import {
  getUserById,
  getSetting,
  updateUserLiveStatus,
  createLiveRecord,
  updateLiveRecord,
  type DbLiveRecord
} from '../database'

// 画质优先级：从高到低（真实清晰度顺序，SD2 高清 > SD1 标清）
const QUALITY_ORDER = ['FULL_HD1', 'HD1', 'SD2', 'SD1']

export type LiveStage = 'checking' | 'not-live' | 'recording' | 'completed' | 'stopped' | 'failed'

export interface LiveProgress {
  userId: number
  recordId: number | null
  nickname: string
  status: LiveStage
  roomId: string | null
  title: string | null
  filePath: string | null
  message: string
}

interface RunningRecording {
  proc: ChildProcess
  recordId: number
  roomId: string
  filePath: string
  stopReason?: 'manual' | 'ended'
  watchdog?: ReturnType<typeof setInterval>
}

// key: userId —— 保证同一用户同一时刻只录一路
const runningRecordings: Map<number, RunningRecording> = new Map()

// 看门狗轮询间隔：抖音直播结束后 CDN 常保持连接不断、只是停发数据，
// ffmpeg 会一直傻等不退出，必须定时查开播状态、结束了主动停。
const LIVE_WATCHDOG_INTERVAL_MS = 45_000

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

function timestampStr(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`
}

function sendProgress(progress: LiveProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('live:progress', progress)
  }
}

function getLiveOutputPath(): string {
  const custom = getSetting('live_output_path')
  if (custom && custom.trim()) {
    return custom
  }
  return join(app.getPath('userData'), 'Download', 'live')
}

export function isRecordingLive(userId: number): boolean {
  return runningRecordings.has(userId)
}

export function getRecordingUserIds(): number[] {
  return Array.from(runningRecordings.keys())
}

// 录制结束的统一收尾：回写记录 + 用户状态 + 推送事件
function finishRecording(userId: number, status: DbLiveRecord['status'], error?: string): void {
  const rec = runningRecordings.get(userId)
  if (!rec) return
  if (rec.watchdog) clearInterval(rec.watchdog)
  runningRecordings.delete(userId)

  let size = 0
  try {
    size = statSync(rec.filePath).size
  } catch {
    // 文件可能未生成
  }

  updateLiveRecord(rec.recordId, {
    status,
    file_size: size,
    error,
    ended_at: nowSec()
  })
  updateUserLiveStatus(userId, 'idle')

  const user = getUserById(userId)
  const messageMap: Record<string, string> = {
    completed: '录制完成（直播已结束）',
    stopped: '已手动停止录制',
    failed: `录制失败：${error || '未知错误'}`
  }
  sendProgress({
    userId,
    recordId: rec.recordId,
    nickname: user?.nickname || '',
    status: status === 'recording' ? 'recording' : (status as LiveStage),
    roomId: rec.roomId,
    title: null,
    filePath: rec.filePath,
    message: messageMap[status] || status
  })
}

interface StreamPick {
  url: string
  quality: string
}

interface LiveLike {
  flvPullUrl?: Record<string, string> | null
  toRaw?: () => unknown
}

interface StreamDataJson {
  data?: Record<string, { main?: { flv?: string; hls?: string } }>
}

interface LiveRawData {
  data?: {
    room?: {
      stream_url?: {
        live_core_sdk_data?: { pull_data?: { stream_data?: string } }
      }
    }
  }
}

/**
 * 选择最佳推流地址。
 * 优先「原画 origin」——它藏在 live_core_sdk_data.pull_data.stream_data 里，
 * 是主播实际推的原始流，比标准 flv_pull_url 的 FULL_HD1（蓝光转码，码率被压低）更清晰。
 * 取不到原画再退回标准档位 FULL_HD1 > HD1 > SD2 > SD1。
 */
function pickBestStream(live: LiveLike): StreamPick | null {
  // 1) 原画 origin
  try {
    const raw = live.toRaw?.() as LiveRawData | undefined
    const streamDataStr = raw?.data?.room?.stream_url?.live_core_sdk_data?.pull_data?.stream_data
    if (streamDataStr) {
      const parsed = JSON.parse(streamDataStr) as StreamDataJson
      const originFlv = parsed?.data?.origin?.main?.flv
      if (originFlv) {
        return { url: originFlv, quality: 'ORIGIN' }
      }
    }
  } catch {
    // 原画解析失败，退回标准档位
  }

  // 2) 标准 flv 档位
  const flv = live.flvPullUrl || {}
  const key = QUALITY_ORDER.find((k) => flv[k]) || Object.keys(flv)[0]
  if (key && flv[key]) {
    return { url: flv[key], quality: key }
  }
  return null
}

/**
 * 检测单个用户是否开播，若在播且未在录制则开始录制。
 * 供调度器 cron 与手动「立即检测」共用。返回是否已开始/正在录制。
 */
export async function checkAndRecordUser(userId: number): Promise<boolean> {
  // 已在录制中，跳过（避免重复起进程）
  if (runningRecordings.has(userId)) {
    return true
  }

  const user = getUserById(userId)
  if (!user) {
    throw new Error('用户不存在')
  }

  const handler = getDouyinHandler()
  if (!handler) {
    throw new Error('请先配置抖音 Cookie')
  }

  sendProgress({
    userId,
    recordId: null,
    nickname: user.nickname,
    status: 'checking',
    roomId: null,
    title: null,
    filePath: null,
    message: '检测开播状态...'
  })

  // 1) 拿 uid（优先用库里已存的，缺失才请求 profile）
  let uid = user.uid
  if (!uid) {
    const profile = await handler.fetchUserProfile(user.sec_uid)
    uid = profile?.uid || ''
  }
  if (!uid) {
    throw new Error('无法获取用户 uid')
  }

  // 2) 开播判断（liveStatus === 1 表示在播），roomIdStr 为精确字符串
  const status = await handler.fetchUserLiveStatus(String(uid))
  if (status.liveStatus !== 1 || !status.roomIdStr) {
    updateUserLiveStatus(userId, 'idle')
    sendProgress({
      userId,
      recordId: null,
      nickname: user.nickname,
      status: 'not-live',
      roomId: null,
      title: null,
      filePath: null,
      message: '当前未开播'
    })
    return false
  }

  const roomId = status.roomIdStr

  // 3) 取直播间信息 + 推流地址（优先原画）
  const live = await handler.fetchUserLiveVideos2(roomId)
  const pick = pickBestStream(live)
  if (!pick) {
    throw new Error('无可用推流地址')
  }
  const streamUrl = pick.url
  const key = pick.quality
  const title = live.liveTitle || ''
  console.log(
    `[Live] 房间 ${roomId} 可用档位: ${Object.keys(live.flvPullUrl || {}).join(', ') || '无'} | 选用: ${key}`
  )

  // 4) 准备输出路径
  const userDir = join(getLiveOutputPath(), user.sec_uid)
  mkdirSync(userDir, { recursive: true })
  const filePath = join(userDir, `live_${roomId}_${timestampStr()}.flv`)

  const recordId = createLiveRecord({
    user_id: userId,
    sec_uid: user.sec_uid,
    nickname: user.nickname,
    room_id: roomId,
    title,
    quality: key,
    file_path: filePath
  })
  updateUserLiveStatus(userId, 'recording', nowSec())

  // 5) ffmpeg 录制（-c copy 直接转储，不转码）；带最大时长上限（0=不限）。
  // -rw_timeout：60s 收不到数据就自己退出，作为看门狗的兜底。
  const maxDurationMin = parseInt(getSetting('live_max_duration') || '0') || 0
  const args = [
    '-y',
    '-rw_timeout',
    '60000000',
    '-headers',
    'Referer: https://live.douyin.com/\r\n',
    '-i',
    streamUrl
  ]
  if (maxDurationMin > 0) {
    args.push('-t', String(maxDurationMin * 60))
  }
  args.push('-c', 'copy', filePath)

  const proc = spawn(ffmpegPath, args)
  const rec: RunningRecording = { proc, recordId, roomId, filePath }
  runningRecordings.set(userId, rec)

  track('live_record_started')

  // 看门狗：定时查是否还在播，结束了主动停（抖音断流后 ffmpeg 不会自动退出）
  rec.watchdog = setInterval(() => {
    void (async () => {
      try {
        const st = await handler.fetchUserLiveStatus(String(uid))
        if (st.liveStatus !== 1) {
          rec.stopReason = 'ended'
          rec.proc.kill('SIGINT')
        }
      } catch {
        // 网络抖动忽略，靠 -rw_timeout 兜底
      }
    })()
  }, LIVE_WATCHDOG_INTERVAL_MS)

  sendProgress({
    userId,
    recordId,
    nickname: user.nickname,
    status: 'recording',
    roomId,
    title,
    filePath,
    message: `开始录制：${title || roomId}（画质 ${key}）`
  })

  proc.on('error', (err) => finishRecording(userId, 'failed', err.message))
  proc.on('close', (code) => {
    // 用 stopReason 而非退出码判断（Windows 上 kill 是硬杀、退出码不定）
    if (rec.stopReason === 'manual') {
      finishRecording(userId, 'stopped')
    } else if (rec.stopReason === 'ended') {
      finishRecording(userId, 'completed')
    } else if (code === 0) {
      finishRecording(userId, 'completed')
    } else {
      finishRecording(userId, 'failed', `ffmpeg 退出码 ${code}`)
    }
  })

  return true
}

/**
 * 停止某用户的录制（手动）。SIGINT 让 ffmpeg 优雅写完当前文件。
 */
export function stopLiveRecording(userId: number): void {
  const rec = runningRecordings.get(userId)
  if (!rec) return
  rec.stopReason = 'manual'
  rec.proc.kill('SIGINT')
}

/**
 * 停止全部录制（应用退出时调用）。
 */
export function stopAllLiveRecordings(): void {
  for (const [, rec] of runningRecordings) {
    rec.stopReason = 'manual'
    rec.proc.kill('SIGINT')
  }
}
