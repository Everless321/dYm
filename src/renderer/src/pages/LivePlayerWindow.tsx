import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

interface Props {
  recordId: number | null
}

type Stage = 'loading' | 'ready' | 'error'

// 面板最多渲染的弹幕条数（只保留贴近当前时间的一段，避免长直播卡顿）
const MAX_VISIBLE = 200
const OFFSET_KEY = 'live_danmaku_offset'

/** 找到第一个 t > target 的下标（升序数组上界二分） */
function upperBound(arr: DanmakuLine[], target: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid].t <= target) lo = mid + 1
    else hi = mid
  }
  return lo
}

export default function LivePlayerWindow({ recordId }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Stage>('loading')
  const [errMsg, setErrMsg] = useState('')
  const [info, setInfo] = useState<LivePlaybackInfo | null>(null)
  const [playError, setPlayError] = useState<string | null>(null)
  const [danmaku, setDanmaku] = useState<DanmakuLine[]>([])
  const [currentMs, setCurrentMs] = useState(0)
  // 延迟补偿（秒）：直播画面经 CDN 比弹幕慢几秒，调大可把弹幕整体往后推
  const [offsetSec, setOffsetSec] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem(OFFSET_KEY) || '')
    return Number.isFinite(saved) ? saved : 0
  })

  useEffect(() => {
    localStorage.setItem(OFFSET_KEY, String(offsetSec))
  }, [offsetSec])

  useEffect(() => {
    if (recordId == null) {
      setStage('error')
      setErrMsg('无效的记录 ID')
      return
    }
    let cancelled = false
    setStage('loading')
    window.api.live
      .preparePlayback(recordId)
      .then((d) => {
        if (cancelled) return
        setInfo(d)
        setStage('ready')
      })
      .catch((e) => {
        if (cancelled) return
        setErrMsg((e as Error).message || '视频准备失败')
        setStage('error')
      })
    // 弹幕独立加载，失败不影响播放
    window.api.live
      .getDanmaku(recordId)
      .then((list) => {
        if (!cancelled) setDanmaku(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [recordId])

  // 当前应显示的弹幕：t <= 视频时间 - 延迟补偿
  const visible = useMemo(() => {
    if (danmaku.length === 0) return []
    const threshold = currentMs - offsetSec * 1000
    const end = upperBound(danmaku, threshold)
    return danmaku.slice(Math.max(0, end - MAX_VISIBLE), end)
  }, [danmaku, currentMs, offsetSec])

  // 新弹幕进来后贴底
  useLayoutEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [visible])

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-white">
      {/* 顶部标题条 */}
      <header className="h-12 flex items-center gap-3 px-4 bg-[#111] border-b border-white/10 shrink-0">
        <span className="text-sm font-medium truncate">{info?.nickname || '直播回放'}</span>
        {info?.title && <span className="text-xs text-white/50 truncate">{info.title}</span>}
        {info?.quality && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-white/70 shrink-0">
            {info.quality}
          </span>
        )}
      </header>

      {/* 主体：左视频 右弹幕 */}
      <div className="flex-1 flex min-h-0">
        {/* 视频区 */}
        <div className="flex-1 relative bg-black min-w-0 flex items-center justify-center">
          {stage === 'loading' && (
            <div className="flex flex-col items-center gap-3 text-center px-6">
              <div className="h-8 w-8 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
              <p className="text-sm text-white/70">加载中…</p>
            </div>
          )}

          {stage === 'error' && <p className="text-sm text-white/60 px-6 text-center">{errMsg}</p>}

          {stage === 'ready' && info && (
            <video
              ref={videoRef}
              src={info.videoUrl}
              controls
              autoPlay
              className="w-full h-full bg-black"
              onTimeUpdate={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
              onSeeked={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
              onError={(e) => {
                const err = e.currentTarget.error
                setPlayError(
                  err ? `错误码 ${err.code}${err.message ? `：${err.message}` : ''}` : '未知错误'
                )
              }}
            />
          )}

          {playError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 text-center px-6">
              <p className="text-sm text-white/80">无法播放此视频</p>
              <p className="text-xs text-white/50 max-w-sm">
                {playError}
                <br />
                可用外部播放器打开文件。
              </p>
              {info?.filePath && (
                <button
                  onClick={() => window.api.live.revealFile(info.filePath!)}
                  className="mt-1 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-sm transition-colors"
                >
                  在文件夹中显示
                </button>
              )}
            </div>
          )}
        </div>

        {/* 弹幕面板 */}
        <aside className="w-80 shrink-0 flex flex-col bg-[#0d0d0d] border-l border-white/10">
          <div className="h-10 flex items-center justify-between px-4 border-b border-white/10 shrink-0">
            <span className="text-sm font-medium text-white/80">
              弹幕
              {danmaku.length > 0 && (
                <span className="ml-1.5 text-xs text-white/40">{danmaku.length}</span>
              )}
            </span>
            {danmaku.length > 0 && (
              <div className="flex items-center gap-1" title="弹幕相对画面的延迟补偿">
                <button
                  onClick={() => setOffsetSec((v) => Math.round((v - 0.5) * 2) / 2)}
                  className="h-5 w-5 rounded bg-white/10 hover:bg-white/20 text-xs leading-none transition-colors"
                >
                  −
                </button>
                <span className="text-[11px] text-white/50 tabular-nums w-10 text-center">
                  {offsetSec > 0 ? `+${offsetSec}` : offsetSec}s
                </span>
                <button
                  onClick={() => setOffsetSec((v) => Math.round((v + 0.5) * 2) / 2)}
                  className="h-5 w-5 rounded bg-white/10 hover:bg-white/20 text-xs leading-none transition-colors"
                >
                  +
                </button>
              </div>
            )}
          </div>

          {danmaku.length === 0 ? (
            <div className="flex-1 flex items-center justify-center px-6 text-center">
              <p className="text-xs text-white/40 leading-relaxed">
                本场直播未记录弹幕
                <br />
                （弹幕录制上线前的录制不含弹幕）
              </p>
            </div>
          ) : (
            <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
              {visible.map((d, i) => (
                <div key={`${d.t}-${i}`} className="text-xs leading-relaxed break-words">
                  {d.type === 'chat' && (
                    <>
                      <span className="text-[#7EB6FF]">{d.name}</span>
                      <span className="text-white/40">：</span>
                      <span className="text-white/85">{d.text}</span>
                    </>
                  )}
                  {d.type === 'gift' && (
                    <span className="text-[#FFB454]">
                      {d.name} 送出 {d.gift}
                      {d.count && d.count > 1 ? ` ×${d.count}` : ''}
                    </span>
                  )}
                  {d.type === 'member' && (
                    <span className="text-white/35">{d.name} 进入直播间</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
