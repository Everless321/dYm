import { useState, useEffect, useRef, useMemo } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  X,
  Play,
  Heart,
  MessageCircle,
  Volume2,
  VolumeX,
  Download
} from 'lucide-react'
import { getMergedTags } from '@/lib/utils'

interface MediaViewerProps {
  post: DbPost | null
  open: boolean
  onOpenChange: (open: boolean) => void
  allPosts?: DbPost[]
  onSelectPost?: (post: DbPost) => void
}

const IMAGE_AUTO_INTERVAL = 3000

export function MediaViewer({
  post,
  open,
  onOpenChange,
  allPosts = [],
  onSelectPost
}: MediaViewerProps) {
  const [media, setMedia] = useState<MediaFiles | null>(null)
  const [loading, setLoading] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [recommendCovers, setRecommendCovers] = useState<Map<number, string>>(new Map())
  const [manualOverride, setManualOverride] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
    if (!post || allPosts.length === 0) return []

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
  }, [post, allPosts])

  // 加载推荐视频的封面
  useEffect(() => {
    const loadCovers = async () => {
      const covers = new Map<number, string>()
      for (const rec of recommendations) {
        try {
          // 总是调用 getCoverPath 获取实际封面路径
          const coverPath = await window.api.post.getCoverPath(rec.sec_uid, rec.folder_name)
          console.log('Cover path for', rec.id, ':', coverPath)
          if (coverPath) {
            covers.set(rec.id, coverPath)
          }
        } catch (error) {
          console.error('Failed to load cover for', rec.id, error)
        }
      }
      setRecommendCovers(covers)
    }
    if (recommendations.length > 0) {
      loadCovers()
    }
  }, [recommendations])

  const loadMedia = async () => {
    if (!post) return
    setLoading(true)
    try {
      console.log('Loading media for:', {
        sec_uid: post.sec_uid,
        folder_name: post.folder_name,
        aweme_type: post.aweme_type
      })
      const result = await window.api.post.getMediaFiles(
        post.sec_uid,
        post.folder_name,
        post.aweme_type
      )
      console.log('Media result:', result)
      setMedia(result)
    } catch (error) {
      console.error('Failed to load media:', error)
    } finally {
      setLoading(false)
    }
  }

  const isImages = media?.type === 'images'
  const images = media?.images || []
  const imageVideos = media?.imageVideos || []
  const currentImageVideo = imageVideos[currentIndex] || null
  const hasMultipleImages = images.length > 1

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

  const handlePrev = () => {
    setManualOverride(true)
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1))
  }

  const handleNext = () => {
    setManualOverride(true)
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0))
  }

  const handleSelectIndex = (idx: number) => {
    setManualOverride(true)
    setCurrentIndex(idx)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isImages && hasMultipleImages) {
      if (e.key === 'ArrowLeft') handlePrev()
      if (e.key === 'ArrowRight') handleNext()
    }
    if (e.key === 'Escape') onOpenChange(false)
  }

  const handleDownload = async () => {
    if (!post) return
    try {
      await window.api.post.openFolder(post.sec_uid, post.folder_name)
    } catch (error) {
      console.error('Failed to open folder:', error)
    }
  }

  const handleSelectRecommend = (rec: DbPost) => {
    if (onSelectPost) {
      onSelectPost(rec)
    }
  }

  // 解析标签（合并 AI + 手动）
  const tags = post ? getMergedTags(post) : []

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="flex bg-white rounded-2xl overflow-hidden shadow-xl border border-[#E5E5E7]"
        style={{ width: 780, height: 520 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {/* 左侧 - 视频/图片区域 */}
        <div className="relative bg-black flex items-center justify-center" style={{ width: 380 }}>
          {loading ? (
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
          ) : media ? (
            isImages ? (
              <>
                {images.length > 0 &&
                  (currentImageVideo ? (
                    <video
                      key={currentImageVideo}
                      src={`local://file${currentImageVideo}`}
                      poster={`local://file${images[currentIndex]}`}
                      className="max-w-full max-h-full object-contain"
                      autoPlay
                      loop
                      muted
                      playsInline
                    />
                  ) : (
                    <img
                      src={`local://file${images[currentIndex]}`}
                      alt={`Image ${currentIndex + 1}`}
                      className="max-w-full max-h-full object-contain"
                    />
                  ))}
                {hasMultipleImages && (
                  <>
                    <button
                      className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors"
                      onClick={handlePrev}
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors"
                      onClick={handleNext}
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                    {/* 图片指示器 */}
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
                      {images.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSelectIndex(idx)}
                          className={`w-1.5 h-1.5 rounded-full transition-colors ${
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
                    <audio ref={audioRef} src={`local://file${media.music}`} loop muted={isMuted} />
                    <button
                      className="absolute bottom-4 right-4 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors"
                      onClick={() => {
                        setIsMuted(!isMuted)
                        if (audioRef.current) {
                          audioRef.current.muted = !isMuted
                        }
                      }}
                    >
                      {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </button>
                  </>
                )}
              </>
            ) : media.video ? (
              <video
                src={`local://file${media.video}`}
                className="max-w-full max-h-full"
                controls
                autoPlay
              />
            ) : (
              <div className="text-white text-center">
                <p>视频文件未找到</p>
              </div>
            )
          ) : (
            <div className="text-white text-center">
              <p>无法加载媒体文件</p>
            </div>
          )}
        </div>

        {/* 右侧 - 内容区域 */}
        <div className="flex flex-col" style={{ width: 400, padding: 20 }}>
          {/* 标题行 */}
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-medium text-[#1D1D1F] leading-tight line-clamp-2 flex-1">
              {post?.desc || post?.caption || '无标题'}
            </h3>
            <button
              onClick={() => onOpenChange(false)}
              className="w-7 h-7 rounded-full bg-[#F2F2F4] hover:bg-[#E5E5E7] flex items-center justify-center flex-shrink-0 transition-colors"
            >
              <X className="h-4 w-4 text-[#6E6E73]" />
            </button>
          </div>

          {/* 标签行 */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {tags.slice(0, 5).map((tag, idx) => (
                <span
                  key={idx}
                  className="px-2.5 py-1 rounded-full text-xs font-medium bg-[#E8F0FE] text-[#0A84FF]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* 作者行 */}
          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-full bg-[#F2F2F4] flex items-center justify-center overflow-hidden">
                <span className="text-sm font-medium text-[#6E6E73]">
                  {post?.nickname?.charAt(0) || 'U'}
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-[#1D1D1F]">@{post?.nickname}</p>
                <p className="text-xs text-[#A1A1A6]">粉丝 --</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1 text-[#6E6E73]">
                <Heart className="h-4 w-4" />
                <span className="text-xs">--</span>
              </div>
              <div className="flex items-center gap-1 text-[#6E6E73]">
                <MessageCircle className="h-4 w-4" />
                <span className="text-xs">--</span>
              </div>
            </div>
          </div>

          {/* 分割线 */}
          <div className="h-px bg-[#E5E5E7] my-4" />

          {/* 下载按钮 */}
          <button
            onClick={handleDownload}
            className="w-full h-11 rounded-lg bg-[#0A84FF] hover:bg-[#0060D5] text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <Download className="h-4 w-4" />
            打开文件夹
          </button>

          {/* 相关推荐 */}
          <div className="mt-4 flex-1 overflow-hidden">
            <h4 className="text-sm font-medium text-[#1D1D1F] mb-3">相关推荐</h4>
            <div className="space-y-2.5">
              {recommendations.length > 0 ? (
                recommendations.map((rec) => (
                  <button
                    key={rec.id}
                    onClick={() => handleSelectRecommend(rec)}
                    className="w-full flex items-center gap-3 p-1.5 rounded-lg hover:bg-[#F2F2F4] transition-colors text-left"
                  >
                    <div className="w-[70px] h-[70px] rounded-lg bg-[#F2F2F4] overflow-hidden flex-shrink-0">
                      {recommendCovers.get(rec.id) ? (
                        <img
                          src={`local://file${recommendCovers.get(rec.id)}`}
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
                      <p className="text-sm text-[#1D1D1F] line-clamp-2 leading-tight">
                        {rec.desc || rec.caption || '无标题'}
                      </p>
                      <p className="text-xs text-[#A1A1A6] mt-1">@{rec.nickname}</p>
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
