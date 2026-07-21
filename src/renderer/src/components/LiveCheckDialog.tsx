import { useState, useEffect, useCallback } from 'react'
import { Radio, Square, RefreshCw, CircleDot } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface LiveCheckDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 检测/停止后通知外层刷新记录列表 */
  onChanged?: () => void
}

export function LiveCheckDialog({ open, onOpenChange, onChanged }: LiveCheckDialogProps) {
  const [monitoredUsers, setMonitoredUsers] = useState<DbUser[]>([])
  const [recordingUserIds, setRecordingUserIds] = useState<number[]>([])
  const [checkingId, setCheckingId] = useState<number | null>(null)

  const load = useCallback(async () => {
    const [users, ids] = await Promise.all([
      window.api.user.getAll(),
      window.api.live.getRecordingUsers()
    ])
    setMonitoredUsers(users.filter((u) => u.live_record))
    setRecordingUserIds(ids)
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const handleCheckNow = async (userId: number) => {
    setCheckingId(userId)
    try {
      const started = await window.api.live.checkNow(userId)
      if (started) {
        toast.success('检测到开播，已开始录制')
      } else {
        toast.info('当前未开播')
      }
      await load()
      onChanged?.()
    } catch (error) {
      toast.error(`检测失败: ${(error as Error).message}`)
    } finally {
      setCheckingId(null)
    }
  }

  const handleStop = async (userId: number) => {
    const stopped = await window.api.live.stop(userId)
    if (stopped) {
      toast.info('正在停止录制，收尾中…')
    } else {
      toast.warning('没有正在进行的录制（状态已刷新）')
    }
    await load()
    onChanged?.()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>直播检测</DialogTitle>
          <DialogDescription>
            手动检测监控用户当前是否开播，检测到开播会立即开始录制
          </DialogDescription>
        </DialogHeader>

        {monitoredUsers.length === 0 ? (
          <div className="py-8 text-center">
            <div className="h-12 w-12 rounded-full bg-[#F2F2F4] flex items-center justify-center mx-auto mb-3">
              <Radio className="h-6 w-6 text-[#A1A1A6]" />
            </div>
            <p className="text-sm text-[#1D1D1F] font-medium">暂无监控用户</p>
            <p className="text-xs text-[#6E6E73] mt-1">
              在「用户管理」中编辑用户，打开「录制直播」并设置检测计划
            </p>
          </div>
        ) : (
          <div className="max-h-[360px] overflow-y-auto -mx-1 px-1">
            <div className="divide-y divide-[#E5E5E7]">
              {monitoredUsers.map((user) => {
                const isRecording = recordingUserIds.includes(user.id)
                return (
                  <div key={user.id} className="flex items-center gap-3 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#1D1D1F] truncate">
                          {user.nickname}
                        </span>
                        {isRecording && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-600 shrink-0">
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
                        className="border-red-200 text-red-600 hover:bg-red-50 shrink-0"
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
                        className="border-[#E5E5E7] text-[#6E6E73] shrink-0"
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
