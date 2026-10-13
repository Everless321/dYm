import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  X,
  Play,
  Volume2,
  VolumeX,
  Download,
  UserRound,
  LibraryBig
} from 'lucide-react'
import { getMergedTags, toMediaSrc } from '@/lib/utils'
import { formatPostDate } from '@/lib/format'

// xgplayer 体积大，只在真正播放视频时才加载
const VideoPlayer = lazy(() => import('./VideoPlayer').then((m) => ({ default: m.VideoPlayer })))

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
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // 快速切换作品时，旧请求可能晚于新请求返回，用序号丢弃过期结果
  const mediaRequestSeq = useRef(0)

  useEffect(() => {
    if (open && post) {
      loadMedia()
      setManualOverride(false)
      setCurrentIndex(0)
    } else {
      setMedia(null)
      setCurrentIndex(0)
      setManualOverride(false)
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }
    }
  }, [open, post])

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

    // 候选池：排除当前视频
    const candidates = allPosts.filter((p) => p.id !== post.id)

    // 第一优先：同标签的其他作者视频
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

    // 第二优先：同作者的其他视频（最多1个）
    const sameAuthor = candidates.find((p) => p.sec_uid === currentSecUid && !usedIds.has(p.id))
    if (sameAuthor && result.length < 3) {
      result.push(sameAuthor)
      usedIds.add(sameAuthor.id)
    }

    // 第三优先：随机补充其他作者的视频
    const otherAuthors = candidates.filter((p) => p.sec_uid !== currentSecUid && !usedIds.has(p.id))
    for (const p of otherAuthors) {
      if (result.length >= 3) break
      result.push(p)
      usedIds.add(p.id)
    }

    // 如果还不够，补充同作者的
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
          // 总是调用 getCoverPath 获取实际封面路径
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

  const loadMedia = async (): Promise<void> => {
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
  }

  const isImages = media?.type === 'images'
  const images = media?.images || []
  const imageVideos = media?.imageVideos || []
  const currentImageVideo = imageVideos[currentIndex] || null
  const hasMultipleImages = images.length > 1
  const postPosition = post ? allPosts.findIndex((item) => item.id === post.id) : -1

  const selectAdjacentPost = (offset: number): void => {
    if (!onSelectPost || postPosition < 0 || allPosts.length < 2) return
    const nextPosition = (postPosition + offset + allPosts.length) % allPosts.length
    onSelectPost(allPosts[nextPosition])
  }

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

  /**
   * Esc 关闭，←/→ 翻图集。
   * 原先挂在弹层 div 的 React onKeyDown 上，但那个 div 从没获得过焦点，
   * 这段一直没生效过，故改为 window 监听。
   * 视频作品不在这里处理 ←/→ —— 那是播放器的快进快退。
   */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable) return
      if (e.key === 'Escape') {
        onOpenChange(false)
        return
      }
      if (!isImages || !hasMultipleImages) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handlePrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        handleNext()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, isImages, hasMultipleImages, handlePrev, handleNext, onOpenChange])

  const handleDownload = async (): Promise<void> => {
    if (!post) return
    try {
      await window.api.post.openFolder(post.sec_uid, post.folder_name)
    } catch (error) {
      console.error('Failed to open folder:', error)
    }
  }

  const handleSelectRecommend = (rec: DbPost): void => {
    if (onSelectPost) {
      onSelectPost(rec)
    }
  }

  // 解析标签（合并 AI + 手动）
  const tags = post ? getMergedTags(post) : []

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B0B0F]/70 p-5"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="flex overflow-hidden rounded-[14px] border border-[#E5E5E7] bg-white shadow-xl"
        style={{
          width: 'min(1168px, calc(100vw - 40px))',
          height: 'min(860px, calc(100vh - 40px))'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左侧 - 视频/图片区域 */}
        <div className="flex min-w-0 flex-1 flex-col bg-[#0E0E11] text-white">
          <div className="flex h-[50px] shrink-0 items-center gap-3 border-b border-white/10 px-4">
            <span className="text-[13px] font-medium">播放详情</span>
            <span className="font-mono text-[11px] text-white/50">
              {postPosition >= 0 ? `${postPosition + 1} / ${allPosts.length}` : ''}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => selectAdjacentPost(-1)}
                disabled={postPosition < 0 || allPosts.length < 2}
                className="flex h-7 items-center gap-1 rounded px-2 text-xs text-white/70 hover:bg-white/10 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                上一个
              </button>
              <button
                type="button"
                onClick={() => selectAdjacentPost(1)}
                disabled={postPosition < 0 || allPosts.length < 2}
                className="flex h-7 items-center gap-1 rounded px-2 text-xs text-white/70 hover:bg-white/10 disabled:opacity-40"
              >
                下一个
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            {loading ? (
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
            ) : media ? (
              isImages ? (
                <>
                  {images.length > 0 &&
                    (currentImageVideo ? (
                      <video
                        key={currentImageVideo}
                        src={toMediaSrc(currentImageVideo)}
                        poster={toMediaSrc(images[currentIndex])}
                        className="max-h-full max-w-full object-contain"
                        autoPlay
                        loop
                        muted
                        playsInline
                      />
                    ) : (
                      <img
                        src={toMediaSrc(images[currentIndex])}
                        alt={`Image ${currentIndex + 1}`}
                        className="max-h-full max-w-full object-contain"
                      />
                    ))}
                  {hasMultipleImages && (
                    <>
                      <button
                        className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
                        onClick={handlePrev}
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <button
                        className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
                        onClick={handleNext}
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5">
                        {images.map((_, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleSelectIndex(idx)}
                            className={`h-1.5 w-1.5 rounded-full transition-colors ${
                              idx === currentIndex ? 'bg-white' : 'bg-white/40 hover:bg-white/70'
                            }`}
                            aria-label={`第 ${idx + 1} 张`}
                          />
                        ))}
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
                <Suspense
                  fallback={
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
                  }
                >
                  <VideoPlayer url={toMediaSrc(media.video)} className="h-full w-full" />
                </Suspense>
              ) : (
                <div className="text-center text-white">
                  <p>视频文件未找到</p>
                </div>
              )
            ) : (
              <div className="text-center text-white">
                <p>无法加载媒体文件</p>
              </div>
            )}
          </div>
          {isImages && images.length > 0 && (
            <div className="flex h-8 shrink-0 items-center justify-center text-[11px] text-white/60">
              第 {currentIndex + 1} / {images.length} 张
            </div>
          )}
        </div>

        {/* 右侧 - 内容区域 */}
        <div
          className="flex min-w-[320px] flex-col overflow-y-auto bg-white p-5"
          style={{ width: 380 }}
        >
          {/* 标题行 */}
          <div className="flex items-start justify-between gap-3">
            <h3 className="flex-1 text-[18px] font-semibold leading-[26px] text-[#1D1D1F] line-clamp-2">
              {post?.desc || post?.caption || '无标题'}
            </h3>
            <button
              onClick={() => onOpenChange(false)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#6E6E73] transition-colors hover:bg-[#F2F2F4]"
            >
              <X className="h-4 w-4 text-[#6E6E73]" />
            </button>
          </div>
          <p className="mt-1 text-[11px] text-[#A1A1A6]">
            {post?.aweme_type === 68 ? '图集' : '视频'}
            {post?.create_time ? ` · 发布于 ${formatPostDate(post.create_time)}` : ''}
          </p>

          {/* 标签行 */}
          {tags.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-[#A1A1A6]">标签</span>
              {tags.slice(0, 5).map((tag, idx) => (
                <span
                  key={idx}
                  className="rounded-md border border-[#E5E5E7] px-2 py-1 text-xs text-[#6E6E73]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* 作者行 */}
          <div className="mt-5 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#F2F2F4]">
                <span className="text-sm font-medium text-[#6E6E73]">
                  {post?.nickname?.charAt(0) || 'U'}
                </span>
              </div>
              <div className="min-w-0">
                {onAuthorClick && post ? (
                  <button
                    onClick={() => onAuthorClick(post.sec_uid)}
                    title={`查看 @${post.nickname} 的全部作品`}
                    className="block max-w-full truncate text-sm font-medium text-[#1D1D1F] transition-colors hover:text-[#0A84FF] hover:underline"
                  >
                    @{post.nickname}
                  </button>
                ) : (
                  <p className="text-sm font-medium text-[#1D1D1F]">@{post?.nickname}</p>
                )}
              </div>
            </div>
            {post && onViewCreator && (
              <button
                type="button"
                onClick={() => onViewCreator(post.sec_uid)}
                className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs text-[#0A84FF] hover:bg-[#E8F0FE]"
              >
                <UserRound className="h-3.5 w-3.5" />
                查看创作者
              </button>
            )}
          </div>

          {post?.analysis_summary && (
            <div className="mt-5 rounded-lg bg-[#F5F5F7] p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#1D1D1F]">AI 摘要</span>
              </div>
              <p className="text-xs leading-5 text-[#6E6E73]">{post.analysis_summary}</p>
              {(post.analysis_category || post.analysis_content_level != null) && (
                <div className="mt-2 flex items-center gap-2 text-[11px] text-[#A1A1A6]">
                  {post.analysis_category && <span>分类 · {post.analysis_category}</span>}
                  {post.analysis_content_level != null && (
                    <span className="font-mono">评分 · {post.analysis_content_level}/10</span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => post && onAnnotate?.(post.id)}
              className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-[#0A84FF] text-xs font-medium text-white transition-colors hover:bg-[#0060D5]"
            >
              <LibraryBig className="h-3.5 w-3.5" />
              在内容库中标注
            </button>
            <button
              onClick={handleDownload}
              className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-[#E5E5E7] bg-white text-xs font-medium text-[#1D1D1F] transition-colors hover:bg-[#F2F2F4]"
            >
              <Download className="h-3.5 w-3.5" />
              打开文件夹
            </button>
          </div>

          {/* 相关推荐 */}
          <div className="mt-5 flex-1 overflow-hidden">
            <h4 className="mb-2 flex items-baseline gap-2 text-[13px] font-medium text-[#1D1D1F]">
              相关推荐
              <span className="text-[11px] font-normal text-[#A1A1A6]">同作者 · 同标签</span>
            </h4>
            <div className="space-y-1.5 overflow-y-auto">
              {recommendations.length > 0 ? (
                recommendations.map((rec) => (
                  <button
                    key={rec.id}
                    onClick={() => handleSelectRecommend(rec)}
                    className="flex w-full items-center gap-2 rounded-md p-1.5 text-left transition-colors hover:bg-[#F2F2F4]"
                  >
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-[#F2F2F4]">
                      {recommendCovers.get(rec.id) ? (
                        <img
                          src={toMediaSrc(recommendCovers.get(rec.id)!)}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Play className="h-5 w-5 text-[#A1A1A6]" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="line-clamp-1 text-xs leading-tight text-[#1D1D1F]">
                        {rec.desc || rec.caption || '无标题'}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-[#A1A1A6]">@{rec.nickname}</p>
                    </div>
                  </button>
                ))
              ) : (
                <p className="text-xs text-[#A1A1A6] text-center py-4">暂无相关推荐</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
