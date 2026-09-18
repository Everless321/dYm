import { spawn, type ChildProcess } from 'child_process'
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { mkdirSync, statSync } from 'fs'
import { ffmpegPath } from '../../utils/ffmpeg-path'
import { track } from '../telemetry'
import { getDouyinHandler } from '../douyin/client'
import { getBrowserUserAgent } from '../../utils/user-agent'
import { downloadLiveCover } from './cover'
import { startDanmakuRecording, danmakuPathFor, type DanmakuRecorder } from './danmaku'
import { enqueueConvert } from './convert'
import {
  getUserById,
  getSetting,
  updateUserLiveStatus,
  createLiveRecord,
  updateLiveRecord,
  type DbLiveRecord
} from '../../database'

// 画质优先级：从高到低（真实清晰度顺序，SD2 高清 > SD1 标清）
const QUALITY_ORDER = ['FULL_HD1', 'HD1', 'SD2', 'SD1']

export type LiveStage =
  | 'checking'
  | 'not-live'
  | 'recording'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'converting'
  | 'converted'
  | 'convert-failed'

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
  danmaku?: DanmakuRecorder
  killTimer?: ReturnType<typeof setTimeout>
  /** ffmpeg stderr 的最后几行，录制失败时用来给出可读原因 */
  stderrTail: string[]
  /** 看门狗连续查询失败次数，超过阈值就当直播已结束主动收尾 */
  watchdogFailures: number
}

// SIGINT 后等待 ffmpeg 自行收尾的宽限期，超时强杀。
// ffmpeg 卡在阻塞的网络读取时收不到信号，靠 -rw_timeout 要等到 60s 才退出。
// FLV 是流式格式，强杀不会损坏已写入的内容。
const FORCE_KILL_GRACE_MS = 5_000

/** stderr 只留这么多行给失败提示用 */
const STDERR_TAIL_LINES = 20

/** 看门狗连续失败这么多次（Cookie 过期等）就不再等，主动结束录制，避免条目永远挂着 */
const WATCHDOG_MAX_FAILURES = 10

// key: userId —— 保证同一用户同一时刻只录一路
const runningRecordings: Map<number, RunningRecording> = new Map()

// 正在走「检测开播 → 起 ffmpeg」流程的用户。这段流程里有多次 await，
// cron 与手动「立即检测」同时进来时，只靠 runningRecordings 判断会双开进程、写两条记录。
const pendingChecks: Set<number> = new Set()

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

export function getLiveOutputPath(): string {
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
  if (rec.killTimer) clearTimeout(rec.killTimer)
  rec.danmaku?.stop()
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

  // 录制产物立刻转成可播放的 MP4（FLV 只在录制期间用，抗中断）。
  // 退出中不再起转封装 ffmpeg：主进程马上消亡，它会成为孤儿并留下 .part；下次启动 sweepUnconverted 会补
  if (status !== 'recording' && !quitting) {
    enqueueConvert(rec.recordId)
  }
}

interface StreamPick {
  url: string
  quality: string
}

interface LiveLike {
  flvPullUrl?: Record<string, string> | null
  cover?: string | null
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
  // 另一路检测还没走完，本次直接让位，以它的结果为准
  if (pendingChecks.has(userId)) {
    return false
  }

  pendingChecks.add(userId)
  try {
    return await doCheckAndRecord(userId)
  } finally {
    pendingChecks.delete(userId)
  }
}

async function doCheckAndRecord(userId: number): Promise<boolean> {
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
  const baseName = `live_${roomId}_${timestampStr()}`
  const filePath = join(userDir, `${baseName}.flv`)

  // 抓取直播封面（与 .flv 同名 .jpg）；失败不影响录制。
  // 不在这里 await：CDN 卡住会推迟 ffmpeg 启动、漏掉开头，下载完再补写到记录上
  const coverPromise = live.cover
    ? downloadLiveCover(live.cover, join(userDir, `${baseName}.jpg`))
    : Promise.resolve(null)

  const recordId = createLiveRecord({
    user_id: userId,
    sec_uid: user.sec_uid,
    nickname: user.nickname,
    room_id: roomId,
    title,
    quality: key,
    cover_path: undefined,
    file_path: filePath
  })
  updateUserLiveStatus(userId, 'recording', nowSec())
  void coverPromise.then((saved) => {
    if (!saved) return
    try {
      updateLiveRecord(recordId, { cover_path: saved })
    } catch (error) {
      console.warn('[Live] 补写直播封面失败:', (error as Error).message)
    }
  })

  // 5) ffmpeg 录制（-c copy 直接转储，不转码）；带最大时长上限（0=不限）。
  // -rw_timeout：60s 收不到数据就自己退出，作为看门狗的兜底。
  const maxDurationMin = Math.max(0, parseInt(getSetting('live_max_duration') || '0') || 0)
  const args = [
    '-y',
    // 不打进度行、只留错误：stderr 是管道，没人消费时写满缓冲区 ffmpeg 会阻塞，录制静默停住
    '-nostats',
    '-loglevel',
    'error',
    '-rw_timeout',
    '60000000',
    '-headers',
    `Referer: https://live.douyin.com/\r\nUser-Agent: ${getBrowserUserAgent()}\r\n`,
    '-i',
    streamUrl
  ]
  if (maxDurationMin > 0) {
    args.push('-t', String(maxDurationMin * 60))
  }
  args.push('-c', 'copy', filePath)

  // 取录制起点墙钟时间作为弹幕对齐基准：紧贴 spawn，两者同时开始
  const startedAtMs = Date.now()
  const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  const rec: RunningRecording = {
    proc,
    recordId,
    roomId,
    filePath,
    stderrTail: [],
    watchdogFailures: 0
  }
  proc.stderr?.setEncoding('utf-8')
  proc.stderr?.on('data', (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (!line.trim()) continue
      rec.stderrTail.push(line.trim())
      if (rec.stderrTail.length > STDERR_TAIL_LINES) rec.stderrTail.shift()
    }
  })
  // 并行录弹幕（聊天/礼物/进场）到 sidecar，失败不影响录像
  rec.danmaku = startDanmakuRecording(roomId, danmakuPathFor(filePath), startedAtMs)
  runningRecordings.set(userId, rec)

  track('live_record_started')

  // 看门狗：定时查是否还在播，结束了主动停（抖音断流后 ffmpeg 不会自动退出）
  rec.watchdog = setInterval(() => {
    void (async () => {
      try {
        const st = await handler.fetchUserLiveStatus(String(uid))
        rec.watchdogFailures = 0
        if (st.liveStatus !== 1) {
          requestStop(userId, rec, 'ended')
        }
      } catch (error) {
        // 偶发网络抖动忽略，靠 -rw_timeout 兜底；但连续失败（Cookie 过期）不能永远沉默
        rec.watchdogFailures++
        if (rec.watchdogFailures === 1 || rec.watchdogFailures % 5 === 0) {
          console.warn(
            `[Live] 看门狗查询开播状态失败 ${rec.watchdogFailures} 次: ${(error as Error).message}`
          )
        }
        if (rec.watchdogFailures >= WATCHDOG_MAX_FAILURES) {
          console.warn(`[Live] 看门狗连续失败 ${rec.watchdogFailures} 次，主动结束录制`)
          requestStop(userId, rec, 'ended')
        }
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
      const detail = rec.stderrTail.length > 0 ? `：${rec.stderrTail.slice(-3).join(' | ')}` : ''
      finishRecording(userId, 'failed', `ffmpeg 退出码 ${code}${detail}`)
    }
  })

  return true
}

/**
 * 请求 ffmpeg 收尾：SIGINT 让它写完当前文件，宽限期内没退出就强杀。
 * 手动停止和看门狗判定结束共用这一条路径，否则看门狗那边卡住的 ffmpeg 永远不会被清理。
 */
function requestStop(userId: number, rec: RunningRecording, reason: 'manual' | 'ended'): void {
  rec.stopReason = reason
  rec.proc.kill('SIGINT')
  if (!rec.killTimer) {
    rec.killTimer = setTimeout(() => {
      if (runningRecordings.get(userId) === rec) {
        console.warn(`[Live] ffmpeg 未在 ${FORCE_KILL_GRACE_MS}ms 内退出，强制结束`)
        rec.proc.kill('SIGKILL')
      }
    }, FORCE_KILL_GRACE_MS)
  }
}

/**
 * 停止某用户的录制（手动）。SIGINT 让 ffmpeg 优雅写完当前文件。
 */
export function stopLiveRecording(userId: number): boolean {
  const rec = runningRecordings.get(userId)
  // 没有进行中的录制（如应用重启后残留的界面状态），返回 false 让调用方如实反馈
  if (!rec) return false

  // 立即断开弹幕流，不等 ffmpeg 收尾
  rec.danmaku?.stop()
  requestStop(userId, rec, 'manual')
  return true
}

/** 退出时最多等 ffmpeg 收尾这么久；超时就不等了，交给下次启动的 resetStaleLiveStatus */
const QUIT_FLUSH_TIMEOUT_MS = 5_000
let quitting = false

/**
 * 停止某用户的录制并等 ffmpeg 真正退出（带超时）。
 * 删用户目录前必须用这个：只发 SIGINT 就 rm，Windows 上文件仍被占用会 EBUSY 留半截目录。
 */
export function stopLiveRecordingAndWait(
  userId: number,
  timeoutMs = QUIT_FLUSH_TIMEOUT_MS
): Promise<boolean> {
  const rec = runningRecordings.get(userId)
  if (!rec) return Promise.resolve(false)
  const exited = new Promise<void>((resolve) => {
    if (rec.proc.exitCode !== null || rec.proc.signalCode !== null) return resolve()
    rec.proc.once('close', () => resolve())
  })
  stopLiveRecording(userId)
  return Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), timeoutMs))
  ])
}

/**
 * 停止全部录制（应用退出时调用）。
 * 返回的 Promise 在所有 ffmpeg 退出（或超时）后 resolve：SIGINT 之后 ffmpeg 还要写完 FLV 尾部，
 * 进程立刻退出的话文件可能损坏、记录状态也停在 recording。
 */
export function stopAllLiveRecordings(): Promise<void> {
  quitting = true
  const exits: Promise<void>[] = []
  for (const [, rec] of runningRecordings) {
    rec.stopReason = 'manual'
    // 应用马上退出，看门狗与强杀定时器不该再触发
    if (rec.watchdog) clearInterval(rec.watchdog)
    if (rec.killTimer) clearTimeout(rec.killTimer)
    rec.watchdog = undefined
    rec.killTimer = undefined
    rec.danmaku?.stop()
    if (rec.proc.exitCode === null && rec.proc.signalCode === null) {
      exits.push(new Promise<void>((resolve) => rec.proc.once('close', () => resolve())))
      rec.proc.kill('SIGINT')
    }
  }
  if (exits.length === 0) return Promise.resolve()
  return Promise.race([
    Promise.all(exits).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, QUIT_FLUSH_TIMEOUT_MS))
  ])
}

export function hasRunningLiveRecordings(): boolean {
  return runningRecordings.size > 0
}
