import { useEffect, useRef, useState } from 'react'
import Player from 'xgplayer'
import 'xgplayer/dist/index.min.css'
import { cn } from '@/lib/utils'

interface VideoPlayerProps {
  /** 视频地址（本项目里是 local://file 前缀的本地路径） */
  url: string
  poster?: string
  className?: string
}

/** ←/→ 点按一次快进快退的秒数 */
const SEEK_STEP = 10
/** 长按 → 的倍速 */
const HOLD_RATE = 2
/**
 * 按下多久算「长按」。用定时器而不是按键重复事件（e.repeat）来判定 ——
 * 按键重复的首次延迟由系统键盘设置决定，macOS 还允许把按键重复整个关掉，
 * 那样长按就永远进不了倍速。
 */
const HOLD_DELAY = 250
/** 长按 ← 时连续快退的间隔 */
const REWIND_INTERVAL = 200

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || !!el?.isContentEditable
}

/** 西瓜播放器（xgplayer，字节跳动开源）封装 */
export function VideoPlayer({ url, poster, className }: VideoPlayerProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<Player | null>(null)
  const [boosted, setBoosted] = useState(false)

  useEffect(() => {
    if (!containerRef.current || !url) return
    const player = new Player({
      el: containerRef.current,
      url,
      poster,
      lang: 'zh-cn',
      // 该组件只在用户点击后挂载，必然有用户手势，所以不需要 autoplayMuted 兜底
      //（加了会无条件静音，比原来的 <video autoPlay> 退步）
      autoplay: true,
      height: '100%',
      width: '100%',
      // 竖屏视频为主：容器尺寸固定，视频等比缩放放进去
      fitVideoSize: 'fixed',
      videoFillMode: 'contain',
      playbackRate: [0.5, 1, 1.5, 2, 3],
      // 下载交给应用自己的「打开文件夹」，播放器里不重复提供
      download: false,
      pip: true,
      rotate: true,
      screenShot: false,
      // 干脆不加载键盘插件，键位全部由下面的 effect 接管。两个原因：
      // 1. 它的 handleKeyUp 漏掉了 isBodyKeyDown 的复位 —— 按过一次 ←/→ 之后，
      //    keyCodeMap 里每个键都会被 stopPropagation，「↑/↓ 切换作品」和
      //    「Esc 关闭播放器」会就此永久失灵；
      // 2. 它的长按 → 是「先快进一次再切倍速」，我们要的是点按快进、长按倍速。
      // 注意必须用 ignores：实测 keyboard: false 和 keyboard: { disable: true }
      // 都不会传进插件（插件里 config.disable 仍是 false），关不掉。
      ignores: ['keyboard']
    })
    playerRef.current = player
    return () => {
      playerRef.current = null
      player.destroy()
    }
  }, [url, poster])

  /**
   * 空格播放/暂停；←/→ 点按快进快退，长按 → 进倍速、长按 ← 连续快退。
   * ↑/↓ 与 Esc 有意不处理 —— 它们属于外层（切换作品、关闭播放器）。
   */
  useEffect(() => {
    /** pending=已按下但还不知是点按还是长按 */
    let mode: 'idle' | 'pending' | 'boost' | 'rewind' = 'idle'
    let heldKey: string | null = null
    let holdTimer: ReturnType<typeof setTimeout> | null = null
    let rewindTimer: ReturnType<typeof setInterval> | null = null
    let prevRate = 1

    const seekBy = (delta: number): void => {
      const player = playerRef.current
      if (!player) return
      const max = player.duration || 0
      player.currentTime = Math.min(Math.max(player.currentTime + delta, 0), max)
    }

    /** 结束当前按键的一切效果；tapped 为真时按「点按」补一次快进快退 */
    const release = (tapped: boolean): void => {
      if (holdTimer) {
        clearTimeout(holdTimer)
        holdTimer = null
      }
      if (rewindTimer) {
        clearInterval(rewindTimer)
        rewindTimer = null
      }
      if (mode === 'pending' && tapped) {
        seekBy(heldKey === 'ArrowLeft' ? -SEEK_STEP : SEEK_STEP)
      }
      if (mode === 'boost') {
        if (playerRef.current) playerRef.current.playbackRate = prevRate
        setBoosted(false)
      }
      mode = 'idle'
      heldKey = null
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      const player = playerRef.current
      if (!player || isTypingTarget(e.target)) return

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        if (player.paused) player.play()
        else player.pause()
        return
      }

      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      // 系统的按键重复对这里没用，长按由定时器判定
      if (e.repeat || mode !== 'idle') return

      const key = e.key
      mode = 'pending'
      heldKey = key
      holdTimer = setTimeout(() => {
        holdTimer = null
        const current = playerRef.current
        if (!current || mode !== 'pending') return
        if (key === 'ArrowRight') {
          mode = 'boost'
          prevRate = current.playbackRate || 1
          current.playbackRate = HOLD_RATE
          setBoosted(true)
        } else {
          mode = 'rewind'
          seekBy(-SEEK_STEP)
          rewindTimer = setInterval(() => seekBy(-SEEK_STEP), REWIND_INTERVAL)
        }
      }, HOLD_DELAY)
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key !== heldKey) return
      release(true)
    }

    // 长按期间窗口失焦收不到 keyup，不兜底会一直卡在倍速上
    const onBlur = (): void => release(false)

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      release(false)
    }
  }, [])

  return (
    <div className={cn('relative', className)}>
      <div ref={containerRef} className="h-full w-full" />
      {boosted && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
          {HOLD_RATE} 倍速播放中
        </div>
      )}
    </div>
  )
}
