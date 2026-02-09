import { useState, useEffect, useRef, useMemo } from 'react'
import { ChevronLeft, ChevronRight, X, Play, Heart, MessageCircle, Volume2, VolumeX, ExternalLink } from 'lucide-react'
import { postsApi } from '@/api/client'
import type { DbPost, MediaFiles } from '@dym/shared'

interface MediaViewerProps {
  post: DbPost | null
  open: boolean
  onOpenChange: (open: boolean) => void
  allPosts?: DbPost[]
  onSelectPost?: (post: DbPost) => void
}

export function MediaViewer({ post, open, onOpenChange, allPosts = [], onSelectPost }: MediaViewerProps) {
  const [media, setMedia] = useState<MediaFiles | null>(null)
  const [loading, setLoading] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (open && post) {
      loadMedia()
    } else {
      setMedia(null)
      setCurrentIndex(0)
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

  const recommendations = useMemo(() => {
    if (!post || allPosts.length === 0) return []

    const currentTags = post.analysis_tags ? JSON.parse(post.analysis_tags) as string[] : []
    const currentSecUid = post.sec_uid
    const result: DbPost[] = []
    const usedIds = new Set<number>([post.id])

    const candidates = allPosts.filter((p) => p.id !== post.id)

    if (currentTags.length > 0) {
      const sameTagOtherAuthor = candidates
        .filter((p) => {
          if (p.sec_uid === currentSecUid) return false
          const tags = p.analysis_tags ? JSON.parse(p.analysis_tags) as string[] : []
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
  }, [post, allPosts])

  const loadMedia = async () => {
    if (!post) return
    setLoading(true)
    try {
      const result = await postsApi.getMediaFiles(post.sec_uid, post.folder_name, post.aweme_type)
      setMedia(result)
    } catch {
      setMedia(null)
    } finally {
      setLoading(false)
    }
  }

  const isImages = media?.type === 'images'
  const images = media?.images || []
  const hasMultipleImages = images.length > 1

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1))
  }

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isImages && hasMultipleImages) {
      if (e.key === 'ArrowLeft') handlePrev()
      if (e.key === 'ArrowRight') handleNext()
    }
    if (e.key === 'Escape') onOpenChange(false)
  }

  const handleSelectRecommend = (rec: DbPost) => {
    if (onSelectPost) {
      onSelectPost(rec)
    }
  }

  const tags = post?.analysis_tags ? JSON.parse(post.analysis_tags) as string[] : []

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => onOpenChange(false)}>
      <div
        className="flex bg-white rounded-2xl overflow-hidden shadow-xl border border-[#E5E5E7]"
        style={{ width: 780, height: 520 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        {/* Left - Media area */}
        <div className="relative bg-black flex items-center justify-center" style={{ width: 380 }}>
          {loading ? (
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
          ) : media ? (
            isImages ? (
              <>
                {images.length > 0 && (
                  <img
                    src={images[currentIndex]}
                    alt={`Image ${currentIndex + 1}`}
                    className="max-w-full max-h-full object-contain"
                  />
                )}
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
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
                      {images.map((_, idx) => (
                        <div
                          key={idx}
                          className={`w-1.5 h-1.5 rounded-full transition-colors ${
                            idx === currentIndex ? 'bg-white' : 'bg-white/40'
                          }`}
                        />
                      ))}
                    </div>
                  </>
                )}
                {media.music && (
                  <>
                    <audio ref={audioRef} src={media.music} loop muted={isMuted} />
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
                src={media.video}
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

        {/* Right - Content area */}
        <div className="flex flex-col" style={{ width: 400, padding: 20 }}>
          {/* Title */}
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

          {/* Tags */}
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

          {/* Author */}
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

          {/* Divider */}
          <div className="h-px bg-[#E5E5E7] my-4" />

          {/* View on Douyin button (replaces openFolder) */}
          {post?.aweme_id && (
            <a
              href={`https://www.douyin.com/video/${post.aweme_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full h-11 rounded-lg bg-[#0A84FF] hover:bg-[#0060D5] text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              查看原作品
            </a>
          )}

          {/* Recommendations */}
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
                      <img
                        src={postsApi.getCoverUrl(rec.sec_uid, rec.folder_name)}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
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
