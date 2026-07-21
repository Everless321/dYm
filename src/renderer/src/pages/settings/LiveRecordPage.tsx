import { useState, useEffect, useCallback } from 'react'
import { Radio, Square, FolderOpen, Trash2, RefreshCw, CircleDot, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { LiveCheckDialog } from '@/components/LiveCheckDialog'
import { toast } from 'sonner'

const STATUS_CONFIG: Record<LiveRecord['status'], { label: string; bg: string; text: string }> = {
  recording: { label: '录制中', bg: 'bg-red-50', text: 'text-red-600' },
  completed: { label: '已完成', bg: 'bg-green-50', text: 'text-green-600' },
  stopped: { label: '已停止', bg: 'bg-gray-100', text: 'text-gray-600' },
  failed: { label: '失败', bg: 'bg-amber-50', text: 'text-amber-600' }
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatTime(ts: number | null): string {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDuration(start: number, end: number | null): string {
  if (!end) return '进行中'
  const sec = Math.max(0, end - start)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h${m}m`
  if (m > 0) return `${m}m${s}s`
  return `${s}s`
}

export default function LiveRecordPage() {
  const [records, setRecords] = useState<LiveRecord[]>([])
  const [recordingUserIds, setRecordingUserIds] = useState<number[]>([])
  const [convertingIds, setConvertingIds] = useState<number[]>([])
  const [checkDialogOpen, setCheckDialogOpen] = useState(false)

  const loadRecords = useCallback(async () => {
    const list = await window.api.live.getRecords()
    setRecords(list)
  }, [])

  const loadRecordingIds = useCallback(async () => {
    const ids = await window.api.live.getRecordingUsers()
    setRecordingUserIds(ids)
  }, [])

  const loadConvertingIds = useCallback(async () => {
    const ids = await window.api.live.getConvertingIds()
    setConvertingIds(ids)
  }, [])

  useEffect(() => {
    loadRecords()
    loadRecordingIds()
    loadConvertingIds()
    // 订阅录制进度事件，实时刷新
    const unsubscribe = window.api.live.onProgress((p) => {
      loadRecordingIds()
      loadConvertingIds()
      if (p.status === 'recording') {
        toast.success(`开始录制：${p.nickname}`)
        loadRecords()
      } else if (p.status === 'completed' || p.status === 'stopped') {
        toast.info(`录制结束：${p.nickname}`)
        loadRecords()
      } else if (p.status === 'failed') {
        toast.error(`录制失败：${p.nickname} - ${p.message}`)
        loadRecords()
      } else if (p.status === 'converted') {
        toast.success(`转换完成：${p.nickname}，可以观看了`)
        loadRecords()
      } else if (p.status === 'convert-failed') {
        toast.error(`转换失败：${p.nickname} - ${p.message}`)
        loadRecords()
      } else if (p.status === 'converting') {
        loadRecords()
      }
    })
    return unsubscribe
  }, [loadRecords, loadRecordingIds, loadConvertingIds])

  const handleOpen = (rec: LiveRecord) => {
    if (rec.status === 'recording') {
      toast.info('录制进行中，结束并转换完成后才能观看')
      return
    }
    if (convertingIds.includes(rec.id)) {
      toast.info('正在转换为可播放格式，转换完成后即可观看')
      return
    }
    if (rec.file_path && !rec.file_path.toLowerCase().endsWith('.mp4')) {
      toast.warning('该录制尚未完成转换，转换完成后才能观看')
      return
    }
    window.api.live.openPlayer(rec.id)
  }

  const handleStop = async (userId: number) => {
    const stopped = await window.api.live.stop(userId)
    if (stopped) {
      toast.info('正在停止录制，收尾中…')
    } else {
      toast.warning('没有正在进行的录制（状态已刷新）')
    }
    loadRecords()
    loadRecordingIds()
  }

  const handleDelete = async (id: number) => {
    await window.api.live.deleteRecord(id)
    loadRecords()
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-6 border-b border-[#E5E5E7] bg-white">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-[#1D1D1F]">直播录制</h1>
          <span className="text-sm text-[#A1A1A6]">
            {recordingUserIds.length > 0 ? `${recordingUserIds.length} 路录制中` : '空闲'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCheckDialogOpen(true)}
            className="border-[#E5E5E7] text-[#6E6E73]"
          >
            <Radio className="h-4 w-4 mr-2" />
            立即检测
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadRecords()
              loadRecordingIds()
            }}
            className="border-[#E5E5E7] text-[#6E6E73]"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            刷新
          </Button>
        </div>
      </header>

      {/* Content - Records Grid */}
      <div className="flex-1 overflow-auto px-6 pb-8 pt-6">
        <div className="mx-auto max-w-6xl">
          {records.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="rounded-full bg-[#F2F2F4] p-6 mb-4">
                <Radio className="h-12 w-12 text-[#A1A1A6]" />
              </div>
              <h2 className="text-xl font-semibold text-[#1D1D1F] mb-2">暂无录制记录</h2>
              <p className="text-[#6E6E73]">
                在「用户管理」中为用户开启「录制直播」并设置检测计划后，将在这里显示
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
              {records.map((rec) => {
                const sc = STATUS_CONFIG[rec.status]
                const isRecording = rec.status === 'recording'
                const isConverting = convertingIds.includes(rec.id)
                const needsConvert =
                  !isRecording && !!rec.file_path && !rec.file_path.toLowerCase().endsWith('.mp4')
                const playable = !isRecording && !needsConvert
                return (
                  <ContextMenu key={rec.id}>
                    <ContextMenuTrigger asChild>
                      <Card
                        className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow group border-[#E5E5E7] bg-white"
                        onClick={() => handleOpen(rec)}
                      >
                        <div className="aspect-[9/16] bg-[#F2F2F4] relative">
                          {rec.cover_path ? (
                            <img
                              src={`local://file${rec.cover_path}`}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Radio className="h-12 w-12 text-[#A1A1A6]" />
                            </div>
                          )}
                          {/* 状态徽章 */}
                          <div className="absolute top-2 left-2 flex items-center gap-1.5">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${sc.bg} ${sc.text}`}
                            >
                              {isRecording && <CircleDot className="h-3 w-3 animate-pulse" />}
                              {sc.label}
                            </span>
                            {needsConvert && (
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                                  isConverting
                                    ? 'bg-blue-50 text-blue-600'
                                    : 'bg-amber-50 text-amber-600'
                                }`}
                              >
                                {isConverting && <RefreshCw className="h-3 w-3 animate-spin" />}
                                {isConverting ? '转换中' : '未转换'}
                              </span>
                            )}
                          </div>
                          {/* 画质徽章 */}
                          {rec.quality && (
                            <div className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
                              {rec.quality}
                            </div>
                          )}
                          {/* 时长徽章 */}
                          <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
                            {formatDuration(rec.started_at, rec.ended_at)}
                          </div>
                          {/* 悬停播放提示（可播放时才显示播放图标） */}
                          {playable && (
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                              <Play className="h-12 w-12 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                          )}
                        </div>
                        <div className="p-3">
                          <p className="text-sm font-medium text-[#1D1D1F] truncate">
                            {rec.nickname || rec.sec_uid}
                          </p>
                          <p className="text-xs text-[#6E6E73] line-clamp-2 mt-0.5">
                            {rec.title || '（无标题）'}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5 text-xs text-[#A1A1A6]">
                            <span>{formatTime(rec.started_at)}</span>
                            <span>{formatBytes(rec.file_size)}</span>
                          </div>
                          {rec.error && (
                            <p className="text-xs text-red-500 mt-0.5 truncate">{rec.error}</p>
                          )}
                        </div>
                      </Card>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      {isRecording && (
                        <ContextMenuItem
                          onClick={() => handleStop(rec.user_id)}
                          className="text-red-600"
                        >
                          <Square className="h-4 w-4 mr-2" />
                          停止录制
                        </ContextMenuItem>
                      )}
                      {rec.file_path && (
                        <ContextMenuItem onClick={() => window.api.live.revealFile(rec.file_path!)}>
                          <FolderOpen className="h-4 w-4 mr-2" />
                          在文件夹中显示
                        </ContextMenuItem>
                      )}
                      {!isRecording && (
                        <ContextMenuItem
                          onClick={() => handleDelete(rec.id)}
                          className="text-red-600"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          删除记录
                        </ContextMenuItem>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <LiveCheckDialog
        open={checkDialogOpen}
        onOpenChange={setCheckDialogOpen}
        onChanged={() => {
          loadRecords()
          loadRecordingIds()
        }}
      />
    </div>
  )
}
