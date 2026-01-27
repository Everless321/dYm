import { useState, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, X, Images, Video, Volume2, VolumeX } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface MediaViewerProps {
  post: DbPost | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MediaViewer({ post, open, onOpenChange }: MediaViewerProps) {
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
      // 关闭时停止音乐
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }
    }
  }, [open, post])

  // 当有音乐且是图集时自动播放
  useEffect(() => {
    if (media?.music && media.type === 'images' && audioRef.current) {
      audioRef.current.play().catch(() => {
        // 自动播放被阻止，忽略错误
      })
    }
  }, [media])

  const loadMedia = async () => {
    if (!post) return
    setLoading(true)
    try {
      const result = await window.api.post.getMediaFiles(
        post.sec_uid,
        post.folder_name,
        post.aweme_type
      )
      setMedia(result)
    } catch (error) {
      console.error('Failed to load media:', error)
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl w-[90vw] h-[85vh] p-0 gap-0 overflow-hidden"
        showCloseButton={false}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            {isImages ? (
              <Images className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Video className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm font-medium truncate max-w-[300px]">
              {post?.desc || post?.caption || '无标题'}
            </span>
            {isImages && hasMultipleImages && (
              <span className="text-xs text-muted-foreground">
                {currentIndex + 1} / {images.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* 图集有音乐时显示静音按钮 */}
            {isImages && media?.music && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setIsMuted(!isMuted)
                  if (audioRef.current) {
                    audioRef.current.muted = !isMuted
                  }
                }}
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
          {loading ? (
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
          ) : media ? (
            isImages ? (
              <>
                {images.length > 0 && (
                  <img
                    src={`local://${images[currentIndex]}`}
                    alt={`Image ${currentIndex + 1}`}
                    className="max-w-full max-h-full object-contain"
                  />
                )}
                {hasMultipleImages && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white"
                      onClick={handlePrev}
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white"
                      onClick={handleNext}
                    >
                      <ChevronRight className="h-6 w-6" />
                    </Button>
                  </>
                )}
                {/* 图集背景音乐 */}
                {media.music && (
                  <audio
                    ref={audioRef}
                    src={`local://${media.music}`}
                    loop
                    muted={isMuted}
                  />
                )}
              </>
            ) : media.video ? (
              <video
                src={`local://${media.video}`}
                controls
                autoPlay
                className="max-w-full max-h-full"
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

        {/* Footer */}
        <div className="px-4 py-3 border-t">
          <p className="text-xs text-muted-foreground">@{post?.nickname}</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
