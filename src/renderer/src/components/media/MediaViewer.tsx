import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { toast } from 'sonner'
import { createPortal } from 'react-dom'
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  FileX,
  FolderOpen,
  Images,
  Maximize,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCw,
  SkipBack,
  SkipForward,
  Sparkles,
  Tag,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import { getAvatarUrl, getMergedTags, toMediaSrc } from '@/lib/utils'
import { formatBytes, formatCompactNumber, formatMillisTime, formatPostDate } from '@/lib/format'

interface MediaViewerProps {
  post: DbPost | null
  open: boolean
  onOpenChange: (open: boolean) => void
  allPosts?: DbPost[]
  onSelectPost?: (post: DbPost) => void
  /** 传入后作者名可点击，用于跳转查看该作者的全部作品 */
  onAuthorClick?: (secUid: string) => void
  onAnnotate?: (postId: number) => void
  onViewCreator?: (secUid: string) => void
}

const IMAGE_AUTO_INTERVAL = 3000
/** 长按空格多久进 2 倍速（与系统键盘重复延迟无关，用定时器判定） */
const HOLD_DELAY = 250
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || !!el?.isContentEditable
}

export function MediaViewer({
  post,
  open,
  onOpenChange,
  allPosts = [],
  onSelectPost,
  onAuthorClick,
  onAnnotate,
  onViewCreator
}: MediaViewerProps): React.JSX.Element | null {
  const [media, setMedia] = useState<MediaFiles | null>(null)
  const [loading, setLoading] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [recommendCovers, setRecommendCovers] = useState<Map<number, string>>(new Map())
  const [manualOverride, setManualOverride] = useState(false)
  const [creator, setCreator] = useState<DbUser | null>(null)
  // 视频播放状态
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [rate, setRate] = useState(1)
  const [rateMenuOpen, setRateMenuOpen] = useState(false)
  const [loop, setLoop] = useState(false)
  const [boosted, setBoosted] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const progressRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const spaceHeldRef = useRef(false)
  const seekingRef = useRef(false)
  const volumeDragRef = useRef(false)
  // 快速切换作品时，旧请求可能晚于新请求返回，用序号丢弃过期结果
  const mediaRequestSeq = useRef(0)

  const loadMedia = useCallback(async (): Promise<void> => {
    if (!post) return
    const seq = ++mediaRequestSeq.current
    setMedia(null)
    setLoading(true)
    try {
      const result = await window.api.post.getMediaFiles(
        post.sec_uid,
        post.folder_name,
        post.aweme_type
      )
      if (seq !== mediaRequestSeq.current) return
      setMedia(result)
    } catch (error) {
      if (seq !== mediaRequestSeq.current) return
      console.error('Failed to load media:', error)
    } finally {
      if (seq === mediaRequestSeq.current) setLoading(false)
    }
  }, [post])

  useEffect(() => {
    if (open && post) {
      void loadMedia()
      setManualOverride(false)
      setCurrentIndex(0)
      setPlaying(false)
      setCurrentTime(0)
      setBuffered(0)
      setRate(1)
      setRateMenuOpen(false)
      setBoosted(false)
      setCreator(null)
      window.api.user
        .getAll()
        .then((users) => setCreator(users.find((u) => u.sec_uid === post.sec_uid) ?? null))
        .catch(() => {})
    } else {
      setMedia(null)
      setCurrentIndex(0)
      setManualOverride(false)
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }
    }
  }, [open, post, loadMedia])

  useEffect(() => {
    if (media?.music && media.type === 'images' && audioRef.current) {
      audioRef.current.play().catch(() => {})
    }
  }, [media])

  // 相关推荐算法：多样化推荐（同标签优先，但保证作者多样性）
  const recommendations = useMemo(() => {
    if (!open || !post || allPosts.length === 0) return []

    const currentTags = getMergedTags(post)
    const currentSecUid = post.sec_uid
    const result: DbPost[] = []
    const usedIds = new Set<number>([post.id])

    const candidates = allPosts.filter((p) => p.id !== post.id)

    if (currentTags.length > 0) {
      const sameTagOtherAuthor = candidates
        .filter((p) => {
          if (p.sec_uid === currentSecUid) return false
          const tags = getMergedTags(p)
          return tags.some((t) => currentTags.includes(t))
        })
        .slice(0, 2)

      for (const p of sameTagOtherAuthor) {
        if (result.length < 3 && !usedIds.has(p.id)) {
          result.push(p)
          usedIds.add(p.id)
        }
      }
    }

    const sameAuthor = candidates.find((p) => p.sec_uid === currentSecUid && !usedIds.has(p.id))
    if (sameAuthor && result.length < 3) {
      result.push(sameAuthor)
      usedIds.add(sameAuthor.id)
    }

    const otherAuthors = candidates.filter((p) => p.sec_uid !== currentSecUid && !usedIds.has(p.id))
    for (const p of otherAuthors) {
      if (result.length >= 3) break
      result.push(p)
      usedIds.add(p.id)
    }

    if (result.length < 3) {
      const remaining = candidates.filter((p) => !usedIds.has(p.id))
      for (const p of remaining) {
        if (result.length >= 3) break
        result.push(p)
      }
    }

    return result
  }, [open, post, allPosts])

  // 加载推荐视频的封面
  useEffect(() => {
    const loadCovers = async (): Promise<void> => {
      const covers = new Map<number, string>()
      for (const rec of recommendations) {
        try {
          const coverPath = await window.api.post.getCoverPath(rec.sec_uid, rec.folder_name)
          if (coverPath) {
            covers.set(rec.id, coverPath)
          }
        } catch (error) {
          console.error('Failed to load cover for', rec.id, error)
        }
      }
      setRecommendCovers(covers)
    }
    if (open && recommendations.length > 0) {
      loadCovers()
    }
  }, [open, recommendations])

  const isImages = media?.type === 'images'
  const images = media?.images || []
  const imageVideos = media?.imageVideos || []
  const currentImageVideo = imageVideos[currentIndex] || null
  const hasMultipleImages = images.length > 1
  const postPosition = post ? allPosts.findIndex((item) => item.id === post.id) : -1
  const isVideo = media?.type === 'video' && !!media?.video

  const selectAdjacentPost = useCallback(
    (offset: number): void => {
      if (!onSelectPost || postPosition < 0 || allPosts.length < 2) return
      const nextPosition = (postPosition + offset + allPosts.length) % allPosts.length
      onSelectPost(allPosts[nextPosition])
    },
    [onSelectPost, postPosition, allPosts]
  )

  useEffect(() => {
    if (autoTimerRef.current) {
      clearInterval(autoTimerRef.current)
      autoTimerRef.current = null
    }
    if (!open || !isImages || !hasMultipleImages || manualOverride) return
    autoTimerRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0))
    }, IMAGE_AUTO_INTERVAL)
    return () => {
      if (autoTimerRef.current) {
        clearInterval(autoTimerRef.current)
        autoTimerRef.current = null
      }
    }
  }, [open, isImages, hasMultipleImages, images.length, manualOverride])

  const handlePrev = useCallback(() => {
    setManualOverride(true)
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1))
  }, [images.length])

  const handleNext = useCallback(() => {
    setManualOverride(true)
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0))
  }, [images.length])

  const handleSelectIndex = (idx: number): void => {
    setManualOverride(true)
    setCurrentIndex(idx)
  }

  const togglePlay = useCallback((): void => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }, [])

  /** Esc 关闭；←/→ 切上/下一个作品；Space 播放暂停，长按 2 倍速 */
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)) return
      if (e.key === 'Escape') {
        onOpenChange(false)
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        selectAdjacentPost(-1)
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        selectAdjacentPost(1)
        return
      }
      if (e.code === 'Space' && isVideo) {
        e.preventDefault()
        if (e.repeat || spaceHeldRef.current) return
        spaceHeldRef.current = true
        holdTimerRef.current = setTimeout(() => {
          if (videoRef.current) {
            videoRef.current.playbackRate = 2
            setBoosted(true)
          }
        }, HOLD_DELAY)
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return
      spaceHeldRef.current = false
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current)
        holdTimerRef.current = null
      }
      if (boosted) {
        if (videoRef.current) videoRef.current.playbackRate = rate
        setBoosted(false)
      } else if (isVideo && !isTypingTarget(e.target)) {
        togglePlay()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
      spaceHeldRef.current = false
    }
  }, [open, isVideo, boosted, rate, selectAdjacentPost, onOpenChange, togglePlay])

  const handleDownload = async (): Promise<void> => {
    if (!post) return
    try {
      await window.api.post.openFolder(post.sec_uid, post.folder_name)
    } catch (error) {
      console.error('Failed to open folder:', error)
    }
  }

  const handleRedownload = async (): Promise<void> => {
    if (!post) return
    try {
      await window.api.post.redownload(post.aweme_id)
      toast.success('已开始重新下载')
    } catch (error) {
      toast.error(`重新下载失败：${(error as Error).message}`)
    }
  }

  const seekTo = (clientX: number): void => {
    const bar = progressRef.current
    const v = videoRef.current
    if (!bar || !v || !Number.isFinite(v.duration) || v.duration === 0) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    v.currentTime = ratio * v.duration
  }

  const setVolumeAt = (clientX: number, el: HTMLDivElement): void => {
    const v = videoRef.current
    if (!v) return
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    v.volume = ratio
    v.muted = false
  }

  const toggleFullscreen = (): void => {
    const stage = stageRef.current
    if (!stage) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stage.requestFullscreen()
  }

  const title = post?.desc || post?.caption || '无标题'
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const [titleExpanded, setTitleExpanded] = useState(false)
  const [titleClamped, setTitleClamped] = useState(false)

  useEffect(() => {
    setTitleExpanded(false)
    const el = titleRef.current
    if (!open || !el) return
    const measure = (): void => setTitleClamped(el.scrollHeight > el.clientHeight + 1)
    const frame = requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [open, title])

  const tags = post ? getMergedTags(post) : []
  const typeLabel = post?.aweme_type === 68 ? '图集' : '视频'
  const metaParts: string[] = [
    typeLabel,
    ...(post?.duration ? [fmtTime(post.duration)] : []),
    ...(post?.width && post?.height ? [`${post.width}×${post.height}`] : []),
    ...(media?.size ? [formatBytes(media.size)] : []),
    ...(post?.create_time ? [`发布于 ${formatPostDate(post.create_time)}`] : [])
  ]
  const categories = [post?.analysis_category, post?.analysis_scene].filter(
    (item): item is string => Boolean(item)
  )
  const level = post?.analysis_content_level
  const playedPct = duration > 0 ? (currentTime / duration) * 100 : 0
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0

  if (!open) return null

  // 按原型只遮住主内容区，侧边栏保持可见；没有挂载点时退回全窗口
  const overlayRoot = document.querySelector<HTMLElement>('[data-overlay-root]')
  const showPostNav = postPosition >= 0 && allPosts.length > 1

  return createPortal(
    <div
      className={`${overlayRoot ? 'absolute' : 'fixed'} inset-0 z-50 flex bg-[#0B0B0F]/70 p-5`}
      onClick={() => onOpenChange(false)}
    >
      <div
        className="flex h-full w-full overflow-hidden rounded-[14px] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左侧播放器 */}
        <div className="flex min-w-0 flex-1 flex-col bg-[#0E0E11]">
          {/* PlayerTop */}
          <div className="flex shrink-0 items-center gap-2.5 px-[18px] py-[14px]">
            <span className="flex h-[22px] items-center gap-1 rounded-[5px] bg-white/10 px-[7px] text-[11px] font-medium text-white">
              {isImages ? <Images size={11} /> : <Play size={11} />}
              {typeLabel}
            </span>
            <span className="font-mono text-xs text-white/60">
              {postPosition >= 0 ? `${postPosition + 1} / ${allPosts.length}` : ''}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => selectAdjacentPost(-1)}
              disabled={postPosition < 0 || allPosts.length < 2}
              className="flex items-center gap-1.5 disabled:opacity-40"
            >
              <kbd className="flex h-5 items-center rounded border border-white/20 px-1.5 text-[10px] text-white/70">
                ←
              </kbd>
              <span className="text-[11px] text-white/50">上一个</span>
            </button>
            <button
              type="button"
              onClick={() => selectAdjacentPost(1)}
              disabled={postPosition < 0 || allPosts.length < 2}
              className="flex items-center gap-1.5 disabled:opacity-40"
            >
              <kbd className="flex h-5 items-center rounded border border-white/20 px-1.5 text-[10px] text-white/70">
                →
              </kbd>
              <span className="text-[11px] text-white/50">下一个</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex items-center gap-1.5"
            >
              <kbd className="flex h-5 items-center rounded border border-white/20 px-1.5 text-[10px] text-white/70">
                Esc
              </kbd>
              <span className="text-[11px] text-white/50">关闭</span>
            </button>
          </div>

          {/* Stage */}
          <div
            ref={stageRef}
            className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden ${
              showPostNav ? 'px-[72px]' : ''
            }`}
          >
            {/* 封面模糊背景 */}
            {media?.cover && (
              <img
                src={toMediaSrc(media.cover)}
                alt=""
                className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl"
              />
            )}
            {loading ? (
              <div className="relative animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
            ) : media ? (
              isImages ? (
                <>
                  {images.length > 0 &&
                    (currentImageVideo ? (
                      <video
                        key={currentImageVideo}
                        src={toMediaSrc(currentImageVideo)}
                        poster={toMediaSrc(images[currentIndex])}
                        className="relative max-h-full max-w-full rounded-lg object-contain"
                        autoPlay
                        loop
                        muted
                        playsInline
                      />
                    ) : (
                      <img
                        src={toMediaSrc(images[currentIndex])}
                        alt={`Image ${currentIndex + 1}`}
                        className="relative max-h-full max-w-full rounded-lg object-contain"
                      />
                    ))}
                  {hasMultipleImages && (
                    <>
                      <button
                        className={`absolute top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 ${
                          showPostNav ? 'left-[84px]' : 'left-4'
                        }`}
                        onClick={handlePrev}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        className={`absolute top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 ${
                          showPostNav ? 'right-[84px]' : 'right-4'
                        }`}
                        onClick={handleNext}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1">
                        {images.map((_, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleSelectIndex(idx)}
                            className={`rounded-full transition-colors ${
                              idx === currentIndex
                                ? 'h-1.5 w-1.5 bg-white'
                                : 'h-[5px] w-[5px] bg-white/40 hover:bg-white/70'
                            }`}
                            aria-label={`第 ${idx + 1} 张`}
                          />
                        ))}
                      </div>
                      <div className="absolute bottom-9 left-1/2 flex h-[22px] -translate-x-1/2 items-center rounded-[11px] bg-black/50 px-[9px] text-[11px] font-medium text-white">
                        第 {currentIndex + 1} / {images.length} 张
                      </div>
                    </>
                  )}
                  {media.music && (
                    <>
                      <audio ref={audioRef} src={toMediaSrc(media.music)} loop muted={isMuted} />
                      <button
                        className="absolute bottom-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
                        onClick={() => {
                          setIsMuted(!isMuted)
                          if (audioRef.current) audioRef.current.muted = !isMuted
                        }}
                      >
                        {isMuted ? (
                          <VolumeX className="h-4 w-4" />
                        ) : (
                          <Volume2 className="h-4 w-4" />
                        )}
                      </button>
                    </>
                  )}
                </>
              ) : media.video ? (
                <video
                  ref={videoRef}
                  key={media.video}
                  src={toMediaSrc(media.video)}
                  poster={media.cover ? toMediaSrc(media.cover) : undefined}
                  className="relative h-full max-w-full object-contain"
                  autoPlay
                  loop={loop}
                  playsInline
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onDurationChange={(e) => setDuration(e.currentTarget.duration)}
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                  onProgress={(e) => {
                    const v = e.currentTarget
                    if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1))
                  }}
                  onVolumeChange={(e) => {
                    setVolume(e.currentTarget.volume)
                    setIsMuted(e.currentTarget.muted)
                  }}
                  onClick={togglePlay}
                />
              ) : (
                <div className="relative flex flex-col items-center gap-1.5 text-white">
                  <CircleAlert size={20} className="text-[var(--danger)]" />
                  <p className="text-xs">视频文件未找到</p>
                </div>
              )
            ) : (
              <div className="relative flex flex-col items-center gap-1.5 text-white">
                <CircleAlert size={20} className="text-[var(--danger)]" />
                <p className="text-xs">无法加载媒体文件</p>
              </div>
            )}
            {/* 上/下一个作品大圆钮 */}
            {showPostNav && (
              <>
                <button
                  onClick={() => selectAdjacentPost(-1)}
                  className="absolute left-4 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1.5"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/15 text-white transition-colors hover:bg-white/25">
                    <ChevronLeft size={20} />
                  </span>
                  <span className="text-[11px] text-white/50">←</span>
                </button>
                <button
                  onClick={() => selectAdjacentPost(1)}
                  className="absolute right-4 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1.5"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/15 text-white transition-colors hover:bg-white/25">
                    <ChevronRight size={20} />
                  </span>
                  <span className="text-[11px] text-white/50">→</span>
                </button>
              </>
            )}
          </div>

          {/* Controls：仅视频有控制条；图集显示张数在 Stage 内 */}
          {isVideo && (
            <div className="@container flex shrink-0 flex-col gap-2 px-5 pb-3.5 pt-1.5">
              {/* 进度条 */}
              <div
                ref={progressRef}
                className="relative flex h-3.5 cursor-pointer items-center"
                onPointerDown={(e) => {
                  seekingRef.current = true
                  e.currentTarget.setPointerCapture(e.pointerId)
                  seekTo(e.clientX)
                }}
                onPointerMove={(e) => {
                  if (seekingRef.current) seekTo(e.clientX)
                }}
                onPointerUp={() => {
                  seekingRef.current = false
                }}
              >
                <div className="h-1 w-full rounded-sm bg-white/15" />
                <div
                  className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-white/30"
                  style={{ width: `${bufferedPct}%` }}
                />
                <div
                  className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-[var(--accent)]"
                  style={{ width: `${playedPct}%` }}
                />
                <div
                  className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
                  style={{ left: `${playedPct}%` }}
                />
              </div>
              <div className="flex items-center gap-2.5 whitespace-nowrap @min-[560px]:gap-3.5">
                <button
                  onClick={togglePlay}
                  className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-white text-[#0E0E11]"
                >
                  {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
                </button>
                <button
                  onClick={() => selectAdjacentPost(-1)}
                  disabled={postPosition < 0 || allPosts.length < 2}
                  className="text-white/70 transition-colors hover:text-white disabled:opacity-40"
                >
                  <SkipBack size={16} />
                </button>
                <button
                  onClick={() => selectAdjacentPost(1)}
                  disabled={postPosition < 0 || allPosts.length < 2}
                  className="text-white/70 transition-colors hover:text-white disabled:opacity-40"
                >
                  <SkipForward size={16} />
                </button>
                <span className="flex shrink-0 items-center gap-1 font-mono">
                  <span className="text-xs font-medium text-white">{fmtTime(currentTime)}</span>
                  <span className="text-xs text-white/50">/ {fmtTime(duration)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (videoRef.current) videoRef.current.muted = !videoRef.current.muted
                    }}
                    className="text-white/80 transition-colors hover:text-white"
                  >
                    {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                  <div
                    className="relative hidden h-3 w-[72px] cursor-pointer items-center @min-[520px]:flex"
                    onPointerDown={(e) => {
                      volumeDragRef.current = true
                      e.currentTarget.setPointerCapture(e.pointerId)
                      setVolumeAt(e.clientX, e.currentTarget)
                    }}
                    onPointerMove={(e) => {
                      if (volumeDragRef.current) setVolumeAt(e.clientX, e.currentTarget)
                    }}
                    onPointerUp={() => {
                      volumeDragRef.current = false
                    }}
                  >
                    <div className="h-1 w-full rounded-sm bg-white/20" />
                    <div
                      className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-white"
                      style={{ width: `${(isMuted ? 0 : volume) * 100}%` }}
                    />
                    <div
                      className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                      style={{ left: `${(isMuted ? 0 : volume) * 100}%` }}
                    />
                  </div>
                </span>
                <div className="flex-1" />
                <span className="hidden items-center gap-1.5 @min-[680px]:flex">
                  <kbd className="flex h-[18px] items-center rounded border border-white/20 px-1.5 text-[10px] text-white/70">
                    Space
                  </kbd>
                  <span className="text-[11px] text-white/50">长按空格 2 倍速播放</span>
                </span>
                <div className="relative shrink-0">
                  <button
                    onClick={() => setRateMenuOpen((v) => !v)}
                    className="flex h-[26px] items-center gap-1 rounded-[5px] border border-white/30 bg-white/15 px-2"
                  >
                    <span className="text-xs font-medium text-white">倍速</span>
                    <span className="text-xs text-white">
                      {boosted ? '2.0×' : `${rate.toFixed(2).replace(/0$/, '')}×`}
                    </span>
                    <ChevronUp size={12} className="text-white/70" />
                  </button>
                  {rateMenuOpen && (
                    <div className="absolute bottom-8 right-0 z-20 w-[132px] rounded-[10px] border border-white/10 bg-[#26262B]/95 p-[5px] shadow-xl">
                      <p className="px-2 py-1 text-[11px] font-medium text-white/50">播放速度</p>
                      {RATES.map((r) => (
                        <button
                          key={r}
                          onClick={() => {
                            setRate(r)
                            if (videoRef.current) videoRef.current.playbackRate = r
                            setRateMenuOpen(false)
                          }}
                          className={`flex h-[26px] w-full items-center justify-between rounded-[5px] px-2 text-xs ${
                            rate === r
                              ? 'bg-[var(--accent)] font-semibold text-white'
                              : 'text-white hover:bg-white/10'
                          }`}
                        >
                          {r.toFixed(2).replace(/0$/, '')}×{rate === r && <Check size={13} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setLoop((v) => !v)}
                  className={`transition-colors ${loop ? 'text-[var(--accent)]' : 'text-white/70 hover:text-white'}`}
                  title="循环播放"
                >
                  <Repeat size={16} />
                </button>
                <button
                  onClick={toggleFullscreen}
                  className="text-white/70 transition-colors hover:text-white"
                  title="全屏"
                >
                  <Maximize size={16} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 右侧信息面板 */}
        <div className="flex w-[320px] shrink-0 flex-col bg-white xl:w-[380px]">
          <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b border-[var(--border)] py-3 pl-[18px] pr-3">
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">播放详情</span>
            <span className="flex-1 font-mono text-[11px] text-[var(--text-tertiary)]">
              {postPosition >= 0 ? `${postPosition + 1} / ${allPosts.length}` : ''}
            </span>
            <button
              type="button"
              onClick={() => selectAdjacentPost(-1)}
              disabled={postPosition < 0 || allPosts.length < 2}
              className="flex h-7 items-center gap-1 rounded-[6px] border border-[var(--border)] px-[7px] text-xs text-[var(--text-primary)] disabled:opacity-40"
            >
              <ChevronLeft size={13} className="text-[var(--text-secondary)]" />
              上一个
              <span className="hidden text-[10px] text-[var(--text-tertiary)] xl:inline">←</span>
            </button>
            <button
              type="button"
              onClick={() => selectAdjacentPost(1)}
              disabled={postPosition < 0 || allPosts.length < 2}
              className="flex h-7 items-center gap-1 rounded-[6px] border border-[var(--border)] px-[7px] text-xs text-[var(--text-primary)] disabled:opacity-40"
            >
              下一个
              <ChevronRight size={13} className="text-[var(--text-secondary)]" />
              <span className="hidden text-[10px] text-[var(--text-tertiary)] xl:inline">→</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex h-7 items-center gap-1 rounded-[6px] bg-[var(--surface-muted)] px-[7px] text-xs text-[var(--text-primary)]"
            >
              <X size={14} />
              <span className="hidden text-[10px] text-[var(--text-tertiary)] xl:inline">Esc</span>
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[18px] py-4">
            {/* 标题 */}
            <div className="flex flex-col gap-[5px]">
              <h3
                ref={titleRef}
                className={`break-words text-lg font-bold leading-6 text-[var(--text-primary)] ${
                  titleExpanded ? '' : 'line-clamp-3'
                }`}
                title={titleClamped && !titleExpanded ? title : undefined}
              >
                {title}
              </h3>
              {(titleClamped || titleExpanded) && (
                <button
                  type="button"
                  onClick={() => setTitleExpanded((v) => !v)}
                  className="self-start text-xs font-medium text-[var(--accent)]"
                >
                  {titleExpanded ? '收起' : '展开全文'}
                </button>
              )}
              <p className="text-[11px] text-[var(--text-tertiary)]">{metaParts.join(' · ')}</p>
            </div>

            {/* 标签 */}
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((tag, idx) => (
                <span
                  key={idx}
                  className="flex h-[22px] items-center rounded-[5px] bg-[var(--surface-muted)] px-2 text-xs text-[var(--text-secondary)]"
                >
                  # {tag}
                </span>
              ))}
              {post && onAnnotate && (
                <button
                  onClick={() => onAnnotate(post.id)}
                  className="flex h-[22px] items-center gap-[3px] rounded-[5px] border border-[var(--border)] px-[7px] text-xs text-[var(--text-tertiary)]"
                >
                  <Plus size={11} />
                  标签
                </button>
              )}
            </div>

            {/* 作者卡 */}
            <div className="flex items-center gap-2.5 rounded-[10px] border border-[var(--border)] px-3 py-2.5">
              {creator && getAvatarUrl(creator) ? (
                <img
                  src={getAvatarUrl(creator)}
                  alt=""
                  className="h-[38px] w-[38px] rounded-full object-cover"
                />
              ) : (
                <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[var(--surface-muted)] text-sm font-medium text-[var(--text-secondary)]">
                  {post?.nickname?.charAt(0) || 'U'}
                </span>
              )}
              <div className="min-w-0 flex-1">
                {onAuthorClick && post ? (
                  <button
                    onClick={() => onAuthorClick(post.sec_uid)}
                    className="block max-w-full truncate text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--accent)]"
                  >
                    {post.nickname}
                  </button>
                ) : (
                  <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
                    {post?.nickname}
                  </p>
                )}
                <p className="truncate text-[11px] text-[var(--text-tertiary)]">
                  {creator
                    ? `粉丝 ${formatCompactNumber(creator.follower_count)} · 已下载 ${creator.downloaded_count} 个`
                    : `@${post?.nickname}`}
                </p>
              </div>
              {post && (onViewCreator || onAuthorClick) && (
                <button
                  type="button"
                  onClick={() => (onViewCreator ?? onAuthorClick)?.(post.sec_uid)}
                  className="flex h-7 shrink-0 items-center gap-[3px] rounded-[6px] bg-[var(--accent-soft)] px-[9px] text-xs font-medium text-[var(--accent)]"
                >
                  查看全部作品
                  <ArrowRight size={12} />
                </button>
              )}
            </div>

            {/* AI 摘要 */}
            {(post?.analysis_summary || categories.length > 0 || level != null) && (
              <div className="flex flex-col gap-2.5 rounded-[10px] bg-[var(--surface-muted)] p-3">
                <div className="flex items-center gap-1.5">
                  <Sparkles size={13} className="text-[var(--accent)]" />
                  <span className="flex-1 text-xs font-semibold text-[var(--text-primary)]">
                    AI 摘要
                  </span>
                  {post?.analyzed_at && (
                    <span className="text-[11px] text-[var(--text-tertiary)]">
                      分析于 {formatMillisTime(post.analyzed_at)}
                    </span>
                  )}
                </div>
                {post?.analysis_summary && (
                  <p className="text-xs leading-5 text-[var(--text-secondary)]">
                    {post.analysis_summary}
                  </p>
                )}
                {categories.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-9 text-xs text-[var(--text-tertiary)]">分类</span>
                    {categories.map((cat) => (
                      <span
                        key={cat}
                        className="flex h-[22px] items-center rounded-[5px] border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text-primary)]"
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                )}
                {level != null && (
                  <div className="flex items-center gap-2">
                    <span className="w-9 text-xs text-[var(--text-tertiary)]">评分</span>
                    <div className="flex items-center gap-[3px]">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <span
                          key={i}
                          className={`h-2 w-[14px] rounded-sm ${i < level ? 'bg-[var(--success)]' : 'bg-[var(--border)]'}`}
                        />
                      ))}
                    </div>
                    <span className="flex items-end gap-0.5">
                      <span className="text-[15px] font-bold leading-4 text-[var(--success)]">
                        {level}
                      </span>
                      <span className="text-[11px] text-[var(--text-tertiary)]">/ 10</span>
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* 操作 */}
            <div className="flex gap-1.5 whitespace-nowrap">
              <button
                onClick={handleDownload}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-xs font-medium text-[var(--text-primary)]"
              >
                <FolderOpen size={13} className="hidden text-[var(--text-secondary)] xl:block" />
                打开文件夹
              </button>
              <button
                type="button"
                onClick={() => post && onAnnotate?.(post.id)}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[6px] bg-[var(--text-primary)] text-xs font-medium text-white"
              >
                <Tag size={13} className="hidden xl:block" />
                在内容库中标注
              </button>
              <button
                onClick={() => void handleRedownload()}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] text-xs font-medium text-[var(--text-primary)]"
              >
                <RotateCw size={13} className="hidden text-[var(--text-secondary)] xl:block" />
                重新下载
              </button>
            </div>

            {/* 相关推荐 */}
            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center">
                <h4 className="flex-1 text-[13px] font-semibold text-[var(--text-primary)]">
                  相关推荐
                </h4>
                <span className="text-[11px] text-[var(--text-tertiary)]">同作者 · 同标签</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {recommendations.length > 0 ? (
                  recommendations.map((rec) => {
                    const broken = !rec.video_path && rec.aweme_type !== 68
                    const recTags = getMergedTags(rec)
                    return (
                      <button
                        key={rec.id}
                        onClick={() => onSelectPost?.(rec)}
                        className={`flex w-full items-center gap-2.5 rounded-[6px] px-1.5 py-1 text-left ${
                          broken ? 'bg-[var(--danger-soft)]' : 'hover:bg-[var(--surface-muted)]'
                        }`}
                      >
                        <div className="flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-[var(--surface-muted)]">
                          {broken ? (
                            <FileX size={16} className="text-[var(--danger)]" />
                          ) : recommendCovers.get(rec.id) ? (
                            <img
                              src={toMediaSrc(recommendCovers.get(rec.id)!)}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Play className="h-5 w-5 text-[var(--text-tertiary)]" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                            {rec.desc || rec.caption || '无标题'}
                          </p>
                          {broken ? (
                            <p className="mt-0.5 flex items-center gap-1 text-[11px]">
                              <CircleAlert size={12} className="text-[var(--danger)]" />
                              <span className="font-medium text-[var(--danger)]">
                                视频文件未找到
                              </span>
                              <span className="text-[var(--text-tertiary)]">
                                · 可能已被移动或删除
                              </span>
                            </p>
                          ) : (
                            <p className="mt-0.5 truncate text-[11px] text-[var(--text-tertiary)]">
                              @{rec.nickname}
                            </p>
                          )}
                        </div>
                        {broken ? (
                          <span
                            onClick={(e) => {
                              e.stopPropagation()
                              window.api.post
                                .redownload(rec.aweme_id)
                                .then(() => toast.success('已开始重新下载'))
                                .catch((error: Error) =>
                                  toast.error(`重新下载失败：${error.message}`)
                                )
                            }}
                            className="flex h-6 shrink-0 items-center rounded-[5px] border border-[var(--danger)] bg-[var(--surface)] px-2 text-[11px] font-medium text-[var(--danger)]"
                          >
                            重新下载
                          </span>
                        ) : (
                          <span className="shrink-0 font-mono text-[11px] text-[var(--text-tertiary)]">
                            {rec.aweme_type === 68
                              ? `图集${recTags.length ? '' : ''}`
                              : rec.duration
                                ? fmtTime(rec.duration)
                                : ''}
                          </span>
                        )}
                      </button>
                    )
                  })
                ) : (
                  <p className="py-4 text-center text-xs text-[var(--text-tertiary)]">
                    暂无相关推荐
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    overlayRoot ?? document.body
  )
}
