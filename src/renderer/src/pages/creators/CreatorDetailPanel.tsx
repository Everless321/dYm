import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ExternalLink,
  Pencil,
  Play,
  Radio,
  RefreshCw,
  ScanSearch,
  Square,
  Trash2,
  X,
  Folder,
  StickyNote,
  FolderSync,
  Video,
  Images
} from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { getAvatarUrl, toMediaSrc } from '@/lib/utils'
import { formatCompactNumber, formatBytes } from '@/lib/format'
import { SYNC_CRON_PRESETS } from '@/pages/users/UsersPage'

interface CreatorDetailPanelProps {
  user: DbUser
  syncing: boolean
  onEdit: (user: DbUser) => void
  onDelete: (user: DbUser) => void
  onStartSync: (user: DbUser) => void
  onStopSync: (userId: number) => void
  onClose: () => void
}

function cronLabel(cron: string): string {
  const preset = SYNC_CRON_PRESETS.find((item) => item.value === cron.trim())
  return preset ? preset.label : cron || '未设置'
}

function formatTime(ts: number | null): string {
  if (!ts) return '从未同步'
  const diff = Date.now() - ts * 1000
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(ts * 1000).toLocaleDateString()
}

export function CreatorDetailPanel({
  user,
  syncing,
  onEdit,
  onDelete,
  onStartSync,
  onStopSync,
  onClose
}: CreatorDetailPanelProps): React.JSX.Element {
  const navigate = useNavigate()
  const [fileStats, setFileStats] = useState<{ totalSize: number; folderCount: number } | null>(
    null
  )
  const [works, setWorks] = useState<DbPost[]>([])
  const [covers, setCovers] = useState<Record<string, string>>({})
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.files
      .getFileSizes(user.sec_uid)
      .then((sizes) => !cancelled && setFileStats(sizes))
      .catch(() => null)
    void window.api.live
      .isRecording(user.id)
      .then((on) => !cancelled && setRecording(on))
      .catch(() => null)
    void window.api.post
      .getAll(1, 12, { secUid: user.sec_uid }, { field: 'downloaded_at', order: 'DESC' })
      .then(async (result) => {
        if (cancelled) return
        setWorks(result.posts)
        const entries = await Promise.all(
          result.posts.map(async (post) => {
            try {
              const path = await window.api.post.getCoverPath(post.sec_uid, post.folder_name)
              return path ? ([post.aweme_id, toMediaSrc(path)] as const) : null
            } catch {
              return null
            }
          })
        )
        if (cancelled) return
        setCovers(Object.fromEntries(entries.filter((e): e is readonly [string, string] => !!e)))
      })
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [user.id, user.sec_uid])

  const downloadRatio = useMemo(
    () => (user.aweme_count > 0 ? Math.round((user.downloaded_count / user.aweme_count) * 100) : 0),
    [user.aweme_count, user.downloaded_count]
  )

  const scanBroken = async (): Promise<void> => {
    try {
      const results = await window.api.post.scanBroken()
      const mine = results.filter((item) => item.nickname === user.nickname)
      toast.success(mine.length ? `发现 ${mine.length} 个损坏/缺失文件` : '该创作者没有损坏文件', {
        description: mine.length ? '共 ' + results.length + ' 个' : undefined
      })
    } catch (error) {
      toast.error(`扫描失败：${(error as Error).message}`)
    }
  }

  const clearFiles = async (): Promise<void> => {
    if (
      !window.confirm(`确定删除「${user.nickname}」的全部本地文件？数据库记录保留，文件不可恢复。`)
    )
      return
    try {
      const removed = await window.api.files.deleteUserFiles(user.id, user.sec_uid)
      toast.success(`已删除 ${removed} 个文件`)
      setFileStats({ totalSize: 0, folderCount: 0 })
    } catch (error) {
      toast.error(`删除失败：${(error as Error).message}`)
    }
  }

  return (
    <aside className="flex w-[360px] shrink-0 flex-col gap-3 overflow-y-auto">
      <div className="rounded-xl border border-[#E5E5E7] bg-white p-4">
        <div className="flex items-start gap-3">
          <Avatar className="h-14 w-14">
            <AvatarImage src={getAvatarUrl(user)} className="object-cover" />
            <AvatarFallback className="bg-[#E8F0FE] text-lg text-[#0A84FF]">
              {user.nickname?.charAt(0).toUpperCase() || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold text-[#1D1D1F]">{user.nickname}</h3>
              {recording && (
                <span className="flex shrink-0 items-center gap-1 rounded bg-[#FF2D55]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#FF2D55]">
                  <Radio size={10} /> 直播中
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-[#6E6E73]">
              <span className="font-mono">@{user.unique_id || user.short_id || '-'}</span>
              <button
                onClick={() => window.api.system.openInAppBrowser(user.homepage_url, user.nickname)}
                className="flex items-center gap-0.5 text-[#0A84FF] hover:underline"
              >
                打开主页 <ExternalLink size={11} />
              </button>
            </div>
            {user.signature && (
              <p className="mt-1 line-clamp-2 text-xs text-[#6E6E73]">签名：{user.signature}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-[#A1A1A6] hover:bg-[#F2F2F4] hover:text-[#1D1D1F]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => onEdit(user)} className="flex-1">
            <Pencil size={13} className="mr-1" /> 编辑
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDelete(user)}
            className="border-[#FDECEC] text-[#E5484D] hover:bg-[#FDECEC]"
            title="删除创作者"
          >
            <Trash2 size={13} />
          </Button>
          {syncing ? (
            <Button
              size="sm"
              onClick={() => onStopSync(user.id)}
              className="flex-1 bg-[#1D1D1F] text-white"
            >
              <Square size={13} className="mr-1" /> 停止同步
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => onStartSync(user)}
              className="flex-1 bg-[#0A84FF] text-white"
            >
              <Play size={13} className="mr-1" /> 开始同步
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x rounded-xl border border-[#E5E5E7] bg-white">
        {[
          { label: '粉丝', value: formatCompactNumber(user.follower_count) },
          { label: '作品', value: String(user.aweme_count) },
          {
            label: '已下载',
            value: `${downloadRatio}%`,
            sub: `${user.downloaded_count}/${user.aweme_count}`
          }
        ].map((item) => (
          <div key={item.label} className="px-3 py-3 text-center">
            <p className="text-[11px] text-[#6E6E73]">{item.label}</p>
            <p className="mt-0.5 font-mono text-base font-semibold text-[#1D1D1F]">{item.value}</p>
            {item.sub && <p className="text-[10px] text-[#A1A1A6]">{item.sub}</p>}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[#E5E5E7] bg-white p-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-medium text-[#6E6E73]">
            <StickyNote size={13} /> 备注
          </p>
          <button
            onClick={() => onEdit(user)}
            className="rounded p-0.5 text-[#A1A1A6] hover:text-[#0A84FF]"
          >
            <Pencil size={12} />
          </button>
        </div>
        <p className="mt-1.5 text-sm text-[#1D1D1F]">
          {user.remark || <span className="text-[#A1A1A6]">暂无备注</span>}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-[#E5E5E7] bg-white p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-medium text-[#6E6E73]">
              <FolderSync size={13} /> 同步策略
            </p>
            <button
              onClick={() => onEdit(user)}
              className="text-[11px] text-[#0A84FF] hover:underline"
            >
              编辑
            </button>
          </div>
          <div className="mt-2 space-y-1 text-xs">
            <p className="flex items-center gap-1.5">
              <i
                className={`h-1.5 w-1.5 rounded-full ${user.auto_sync ? 'bg-[#1F9D55]' : 'bg-[#A1A1A6]'}`}
              />
              {user.auto_sync ? `自动同步 · ${cronLabel(user.sync_cron)}` : '手动同步'}
            </p>
            <p className="text-[#6E6E73]">
              单次下载上限 {user.max_download_count > 0 ? user.max_download_count : '不限'}
            </p>
            <p className="text-[#6E6E73]">
              上次同步 {formatTime(user.last_sync_at)}
              {user.sync_status === 'error' && <span className="ml-1 text-[#E5484D]">· 失败</span>}
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-[#E5E5E7] bg-white p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-medium text-[#6E6E73]">
              <Radio size={13} /> 直播监测
            </p>
            {recording && (
              <span className="flex items-center gap-1 text-[10px] text-[#FF2D55]">
                <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF2D55]" /> 正在录制
              </span>
            )}
          </div>
          <div className="mt-2 space-y-1 text-xs">
            <p className="flex items-center gap-1.5">
              <i
                className={`h-1.5 w-1.5 rounded-full ${user.live_record ? 'bg-[#1F9D55]' : 'bg-[#A1A1A6]'}`}
              />
              {user.live_record ? `已开启 · ${cronLabel(user.live_check_cron)}检测` : '未开启'}
            </p>
            <button
              onClick={() => navigate('/live')}
              className="text-[11px] text-[#0A84FF] hover:underline"
            >
              查看录制记录 →
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#E5E5E7] bg-white p-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-medium text-[#6E6E73]">
            <Folder size={13} /> 本地文件
          </p>
          <button
            onClick={() => void window.api.post.openFolder(user.sec_uid, '')}
            className="text-[11px] text-[#0A84FF] hover:underline"
          >
            在文件管理器中打开 ↗
          </button>
        </div>
        <p className="mt-2 flex items-center justify-between rounded-lg bg-[#F5F5F7] px-2.5 py-2 font-mono text-[11px] text-[#6E6E73]">
          <span className="truncate">~/Movies/dYm/{user.nickname}</span>
          <span className="shrink-0 text-[#A1A1A6]">
            {fileStats
              ? `${fileStats.folderCount} 个文件 · ${formatBytes(fileStats.totalSize)}`
              : '…'}
          </span>
        </p>
        <div className="mt-2 flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 text-[11px]"
            onClick={() => void scanBroken()}
          >
            <ScanSearch size={12} className="mr-1" /> 扫描损坏文件
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 text-[11px]"
            onClick={() => onEdit(user)}
          >
            <RefreshCw size={12} className="mr-1" /> 修复标题
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 border-[#FDECEC] text-[11px] text-[#E5484D] hover:bg-[#FDECEC]"
            onClick={() => void clearFiles()}
          >
            <Trash2 size={12} className="mr-1" /> 清空文件
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-[#E5E5E7] bg-white p-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-[#1D1D1F]">
            作品{' '}
            <span className="text-[#6E6E73]">
              {user.aweme_count} 个 · 已下载 {user.downloaded_count}
            </span>
          </p>
          <button
            onClick={() => navigate(`/browse?author=${encodeURIComponent(user.sec_uid)}`)}
            className="text-[11px] text-[#0A84FF] hover:underline"
          >
            在视频浏览中查看全部 →
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {works.map((post) => {
            const downloaded = !!post.video_path || !!post.music_path || post.downloaded_at > 0
            return (
              <button
                key={post.id}
                title={post.caption || post.desc || ''}
                onClick={() => navigate(`/browse?author=${encodeURIComponent(user.sec_uid)}`)}
                className="group relative aspect-[3/4] overflow-hidden rounded-md bg-[#F2F2F4]"
              >
                {covers[post.aweme_id] ? (
                  <img
                    src={covers[post.aweme_id]}
                    className="h-full w-full object-cover"
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-[#A1A1A6]">
                    {post.aweme_type === 68 ? <Images size={18} /> : <Video size={18} />}
                  </div>
                )}
                <i
                  className={`absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full ${downloaded ? 'bg-[#1F9D55]' : 'bg-[#A1A1A6]'}`}
                />
              </button>
            )
          })}
          {works.length === 0 && (
            <p className="col-span-4 py-6 text-center text-xs text-[#A1A1A6]">暂无作品记录</p>
          )}
        </div>
        <p className="mt-2 flex gap-3 text-[10px] text-[#A1A1A6]">
          <span>
            <i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#1F9D55]" />
            已下载
          </span>
          <span>
            <i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#A1A1A6]" />
            未下载
          </span>
        </p>
      </div>
    </aside>
  )
}
