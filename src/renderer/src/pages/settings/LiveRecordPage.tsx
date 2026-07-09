import { useState, useEffect, useCallback } from 'react'
import { Radio, Square, FolderOpen, Trash2, RefreshCw, CircleDot, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  const [monitoredUsers, setMonitoredUsers] = useState<DbUser[]>([])
  const [recordingUserIds, setRecordingUserIds] = useState<number[]>([])
  const [checkingId, setCheckingId] = useState<number | null>(null)

  const loadRecords = useCallback(async () => {
    const list = await window.api.live.getRecords()
    setRecords(list)
  }, [])

  const loadMonitored = useCallback(async () => {
    const users = await window.api.user.getAll()
    setMonitoredUsers(users.filter((u) => u.live_record))
  }, [])

  const loadRecordingIds = useCallback(async () => {
    const ids = await window.api.live.getRecordingUsers()
    setRecordingUserIds(ids)
  }, [])

  useEffect(() => {
    loadRecords()
    loadMonitored()
    loadRecordingIds()
    // 订阅录制进度事件，实时刷新
    const unsubscribe = window.api.live.onProgress((p) => {
      loadRecordingIds()
      if (p.status === 'recording') {
        toast.success(`开始录制：${p.nickname}`)
        loadRecords()
      } else if (p.status === 'completed' || p.status === 'stopped') {
        toast.info(`录制结束：${p.nickname}`)
        loadRecords()
      } else if (p.status === 'failed') {
        toast.error(`录制失败：${p.nickname} - ${p.message}`)
        loadRecords()
      }
    })
    return unsubscribe
  }, [loadRecords, loadMonitored, loadRecordingIds])

  const handleCheckNow = async (userId: number) => {
    setCheckingId(userId)
    try {
      const started = await window.api.live.checkNow(userId)
      if (started) {
        toast.success('检测到开播，已开始录制')
      } else {
        toast.info('当前未开播')
      }
      loadRecordingIds()
    } catch (error) {
      toast.error(`检测失败: ${(error as Error).message}`)
    } finally {
      setCheckingId(null)
    }
  }

  const handleStop = async (userId: number) => {
    await window.api.live.stop(userId)
    toast.info('已发送停止指令')
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            loadRecords()
            loadMonitored()
            loadRecordingIds()
          }}
          className="border-[#E5E5E7] text-[#6E6E73]"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-8">
        <div className="mx-auto max-w-5xl space-y-8">
          {/* 监控中的用户 */}
          <section>
            <h2 className="text-sm font-medium text-[#6E6E73] mb-3">
              监控中的用户（{monitoredUsers.length}）
            </h2>
            {monitoredUsers.length === 0 ? (
              <div className="bg-white rounded-2xl border border-[#E5E5E7] p-8 text-center">
                <div className="h-14 w-14 rounded-full bg-[#F2F2F4] flex items-center justify-center mx-auto mb-3">
                  <Radio className="h-7 w-7 text-[#A1A1A6]" />
                </div>
                <p className="text-sm text-[#1D1D1F] font-medium">暂无监控用户</p>
                <p className="text-xs text-[#6E6E73] mt-1">
                  在「用户管理」中编辑用户，打开「录制直播」并设置检测计划
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-[#E5E5E7] divide-y divide-[#E5E5E7] overflow-hidden">
                {monitoredUsers.map((user) => {
                  const isRecording = recordingUserIds.includes(user.id)
                  return (
                    <div key={user.id} className="flex items-center gap-4 px-5 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[#1D1D1F] truncate">
                            {user.nickname}
                          </span>
                          {isRecording && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-600">
                              <CircleDot className="h-3 w-3 animate-pulse" />
                              录制中
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#A1A1A6] font-mono mt-0.5">
                          {user.live_check_cron || '未设置检测计划'}
                        </p>
                      </div>
                      {isRecording ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStop(user.id)}
                          className="border-red-200 text-red-600 hover:bg-red-50"
                        >
                          <Square className="h-4 w-4 mr-1" />
                          停止
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCheckNow(user.id)}
                          disabled={checkingId === user.id}
                          className="border-[#E5E5E7] text-[#6E6E73]"
                        >
                          {checkingId === user.id ? (
                            <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <Radio className="h-4 w-4 mr-1" />
                          )}
                          立即检测
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* 录制记录 */}
          <section>
            <h2 className="text-sm font-medium text-[#6E6E73] mb-3">
              录制记录（{records.length}）
            </h2>
            {records.length === 0 ? (
              <div className="bg-white rounded-2xl border border-[#E5E5E7] p-8 text-center">
                <div className="h-14 w-14 rounded-full bg-[#F2F2F4] flex items-center justify-center mx-auto mb-3">
                  <Clock className="h-7 w-7 text-[#A1A1A6]" />
                </div>
                <p className="text-sm text-[#1D1D1F] font-medium">暂无录制记录</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-[#E5E5E7] divide-y divide-[#E5E5E7] overflow-hidden">
                {records.map((rec) => {
                  const sc = STATUS_CONFIG[rec.status]
                  return (
                    <div key={rec.id} className="flex items-center gap-4 px-5 py-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-[#1D1D1F] truncate">
                            {rec.nickname || rec.sec_uid}
                          </span>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${sc.bg} ${sc.text}`}
                          >
                            {sc.label}
                          </span>
                          {rec.quality && (
                            <span className="text-xs text-[#6E6E73] bg-[#F2F2F4] px-2 py-0.5 rounded">
                              {rec.quality}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-[#6E6E73] truncate mt-0.5">
                          {rec.title || '（无标题）'}
                        </p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-[#A1A1A6]">
                          <span>{formatTime(rec.started_at)}</span>
                          <span>时长 {formatDuration(rec.started_at, rec.ended_at)}</span>
                          <span>{formatBytes(rec.file_size)}</span>
                        </div>
                        {rec.error && (
                          <p className="text-xs text-red-500 mt-0.5 truncate">{rec.error}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {rec.file_path && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => window.api.live.revealFile(rec.file_path!)}
                            title="在文件夹中显示"
                            className="text-[#6E6E73]"
                          >
                            <FolderOpen className="h-4 w-4" />
                          </Button>
                        )}
                        {rec.status !== 'recording' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(rec.id)}
                            title="删除记录"
                            className="text-[#6E6E73] hover:text-red-500"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
