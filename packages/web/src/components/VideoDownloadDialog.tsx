import { useState, useEffect, useCallback } from 'react'
import { Download, Loader2, Images, Video, AlertCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { videoApi } from '@/api/client'
import type { VideoInfo } from '@dym/shared'

interface VideoDownloadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VideoDownloadDialog({ open, onOpenChange }: VideoDownloadDialogProps) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)

  const checkClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && (text.includes('douyin.com') || text.includes('v.douyin.com'))) {
        const urlMatch = text.match(/https?:\/\/[^\s]+douyin\.com[^\s]*/i)
        if (urlMatch) {
          setUrl(urlMatch[0])
        }
      }
    } catch {
      // Clipboard access denied in browser, ignore
    }
  }, [])

  useEffect(() => {
    if (open) {
      checkClipboard()
      setError(null)
      setVideoInfo(null)
    } else {
      setUrl('')
      setVideoInfo(null)
      setError(null)
    }
  }, [open, checkClipboard])

  const parseUrl = async () => {
    if (!url.trim()) {
      setError('请输入链接')
      return
    }

    setLoading(true)
    setError(null)
    setVideoInfo(null)

    try {
      const detail = await videoApi.getDetail(url)
      setVideoInfo(detail)
    } catch (err) {
      setError((err as Error).message || '解析失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    if (!videoInfo) return

    setDownloading(true)
    try {
      await videoApi.downloadToFolder(videoInfo)
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message || '下载失败')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>解析下载</DialogTitle>
          <DialogDescription>
            粘贴抖音作品链接，解析后下载视频或图集
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="粘贴抖音作品链接..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && parseUrl()}
            />
            <Button onClick={parseUrl} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '解析'}
            </Button>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          {videoInfo && (
            <div className="space-y-3">
              <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                <img
                  src={videoInfo.coverUrl}
                  alt={videoInfo.desc}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded flex items-center gap-1">
                  {videoInfo.type === 'images' ? (
                    <>
                      <Images className="h-3 w-3" />
                      图集 ({videoInfo.imageUrls?.length || 0})
                    </>
                  ) : (
                    <>
                      <Video className="h-3 w-3" />
                      视频
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-sm font-medium line-clamp-2">{videoInfo.desc || '无标题'}</p>
                <p className="text-xs text-muted-foreground">@{videoInfo.nickname}</p>
              </div>

              <Button className="w-full" onClick={handleDownload} disabled={downloading}>
                {downloading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    下载中...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    下载到服务器
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
