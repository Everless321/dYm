import { useState, useEffect, useCallback } from 'react'
import {
  Download,
  Loader2,
  Images,
  Video,
  CircleAlert,
  Info,
  Link2,
  ScanSearch,
  CircleCheck,
  UserRound,
  X
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface VideoInfo {
  awemeId: string
  desc: string
  nickname: string
  coverUrl: string
  type: 'video' | 'images'
  videoUrl?: string
  imageUrls?: string[]
}

interface VideoDownloadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VideoDownloadDialog({
  open,
  onOpenChange
}: VideoDownloadDialogProps): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userLinkError, setUserLinkError] = useState(false)
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [followed, setFollowed] = useState(false)

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
      // 剪贴板访问失败，忽略
    }
  }, [])

  useEffect(() => {
    if (open) {
      checkClipboard()
      setError(null)
      setUserLinkError(false)
      setVideoInfo(null)
      setFollowed(false)
    } else {
      setUrl('')
      setVideoInfo(null)
      setError(null)
      setUserLinkError(false)
      setFollowed(false)
    }
  }, [open, checkClipboard])

  const parseUrl = async (): Promise<void> => {
    if (!url.trim()) {
      setError('请输入链接')
      return
    }

    setLoading(true)
    setError(null)
    setUserLinkError(false)
    setVideoInfo(null)
    setFollowed(false)

    try {
      const result = await window.api.douyin.parseUrl(url)
      if (result.type !== 'video') {
        setUserLinkError(true)
        setError('请输入作品链接，不是用户主页链接')
        return
      }

      const detail = await window.api.video.getDetail(url)
      setVideoInfo(detail)
      window.api.user
        .getAll()
        .then((users) => setFollowed(users.some((u) => u.nickname === detail.nickname)))
        .catch(() => setFollowed(false))
    } catch (err) {
      setError((err as Error).message || '解析失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async (): Promise<void> => {
    if (!videoInfo) return

    setDownloading(true)
    try {
      await window.api.video.downloadToFolder(videoInfo)
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message || '下载失败')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] max-w-[520px] gap-0 overflow-y-auto rounded-xl border border-[#E5E5E7] bg-white p-0 shadow-xl">
        <div className="flex items-start gap-3 border-b border-[#E5E5E7] px-6 pb-4 pt-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#E8F0FE]">
            <Link2 className="h-[17px] w-[17px] text-[#0A84FF]" />
          </div>
          <DialogHeader className="min-w-0 flex-1 space-y-1 text-left">
            <DialogTitle className="text-base font-bold leading-6 text-[#1D1D1F]">
              解析下载
            </DialogTitle>
            <DialogDescription className="text-xs text-[#6E6E73]">
              粘贴抖音作品链接，解析后下载视频或图集
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-3 px-6 pb-5 pt-[18px]">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Link2 className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#A1A1A6]" />
              <Input
                placeholder="粘贴抖音作品链接..."
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  setUserLinkError(false)
                }}
                onKeyDown={(e) => e.key === 'Enter' && parseUrl()}
                className={`h-9 rounded-md border-[#E5E5E7] pl-8 pr-7 font-mono text-xs placeholder:font-sans placeholder:text-[#A1A1A6] focus-visible:ring-[#0A84FF] ${
                  userLinkError ? 'border-[#E5484D] focus-visible:ring-[#E5484D]' : ''
                }`}
              />
              {url && (
                <button
                  onClick={() => setUrl('')}
                  className="absolute right-2 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded-full bg-[#C7C7CC] text-white"
                  aria-label="清除"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
            <Button
              onClick={parseUrl}
              disabled={loading}
              className="h-9 rounded-md bg-[#1D1D1F] px-3.5 text-[13px] font-medium text-white hover:bg-black"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
                  解析
                </>
              )}
            </Button>
          </div>

          <p className="-mt-1 text-[11px] text-[#A1A1A6]">
            支持 v.douyin.com 短链与 douyin.com/video/… 作品页链接
          </p>

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-[#FDECEC] px-3 py-2 text-[13px] text-[#E5484D]">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <p className="font-medium">{error}</p>
                {userLinkError && (
                  <p className="mt-0.5 text-xs text-[#E5484D]/80">
                    要下载创作者的全部作品，请到「创作者」页添加
                  </p>
                )}
              </div>
            </div>
          )}

          {videoInfo ? (
            <>
              <div className="flex items-center gap-1.5 text-xs text-[#1F9D55]">
                <CircleCheck className="h-[13px] w-[13px]" />
                <span className="font-medium">解析成功</span>
                <span className="text-[#A1A1A6]">· 作品 ID {videoInfo.awemeId}</span>
              </div>

              <div className="flex gap-3 rounded-lg bg-[#F5F5F7] p-3">
                <div className="relative h-[171px] w-24 shrink-0 overflow-hidden rounded-lg bg-[#E5E5E7]">
                  <img src={videoInfo.coverUrl} alt="" className="h-full w-full object-cover" />
                  <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                    {videoInfo.type === 'images' ? (
                      <>
                        <Images className="h-3 w-3" />
                        图集
                      </>
                    ) : (
                      <>
                        <Video className="h-3 w-3" />
                        视频
                      </>
                    )}
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-5 items-center gap-1 rounded bg-[#E8F0FE] px-1.5 text-[11px] font-medium text-[#0A84FF]">
                      {videoInfo.type === 'images' ? (
                        <Images className="h-3 w-3" />
                      ) : (
                        <Video className="h-3 w-3" />
                      )}
                      {videoInfo.type === 'images'
                        ? `图集${videoInfo.imageUrls ? ` (${videoInfo.imageUrls.length})` : ''}`
                        : '视频'}
                    </span>
                  </div>
                  <p className="line-clamp-4 text-[13px] leading-5 text-[#1D1D1F]">
                    {videoInfo.desc || '无标题'}
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-[#6E6E73]">
                    <UserRound className="h-3.5 w-3.5 text-[#A1A1A6]" />
                    {videoInfo.nickname}
                    {followed && (
                      <span className="rounded bg-[#E8F0FE] px-1.5 py-0.5 text-[10px] text-[#0A84FF]">
                        已关注的创作者
                      </span>
                    )}
                  </p>
                  {videoInfo.type === 'images' && (videoInfo.imageUrls?.length ?? 0) > 0 && (
                    <div className="mt-auto flex gap-1 overflow-hidden">
                      {videoInfo.imageUrls?.slice(0, 5).map((imageUrl, index) => (
                        <img
                          key={`${imageUrl}-${index}`}
                          src={imageUrl}
                          alt=""
                          className="h-10 w-7 rounded object-cover"
                        />
                      ))}
                      {(videoInfo.imageUrls?.length ?? 0) > 5 && (
                        <span className="grid h-10 w-7 place-items-center rounded bg-[#E5E5E7] text-[10px] font-medium text-[#6E6E73]">
                          +{(videoInfo.imageUrls?.length ?? 0) - 5}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-[190px] flex-col items-center justify-center gap-2 rounded-lg bg-[#F5F5F7] text-center">
              <Link2 className="h-6 w-6 text-[#A1A1A6]" />
              <p className="text-[13px] text-[#6E6E73]">解析后显示作品预览</p>
              {!error && (
                <p className="text-[11px] text-[#A1A1A6]">打开窗口时会尝试读取剪贴板中的链接</p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-[#E5E5E7] px-6 py-3.5">
          <span className="flex flex-1 items-center gap-1 text-[11px] text-[#A1A1A6]">
            <Info className="h-3 w-3" />
            无水印原图 / 原视频 · 选择目录后开始下载
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-[34px] rounded-md border-[#E5E5E7] px-4 text-[13px] font-medium text-[#1D1D1F]"
          >
            取消
          </Button>
          <Button
            onClick={handleDownload}
            disabled={!videoInfo || downloading}
            className="h-[34px] rounded-md bg-[#0A84FF] px-3.5 text-[13px] font-medium text-white hover:bg-[#0060D5] disabled:bg-[#C7C7CC]"
          >
            {downloading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                下载中...
              </>
            ) : (
              <>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                选择目录下载
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
