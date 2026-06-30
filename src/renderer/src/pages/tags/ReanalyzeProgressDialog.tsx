import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, XCircle, Loader2, RotateCw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'

interface VideoStatus {
  postId: number
  title: string
  status: 'pending' | 'running' | 'success' | 'failed'
}

interface ReanalyzeProgressDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 要重新标记的 postId 列表 */
  postIds: number[]
  /** 完成后回调（用于刷新列表） */
  onDone?: () => void
}

export function ReanalyzeProgressDialog({
  open,
  onOpenChange,
  postIds,
  onDone
}: ReanalyzeProgressDialogProps) {
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [started, setStarted] = useState(false)
  const [running, setRunning] = useState(false)
  const [statuses, setStatuses] = useState<Map<number, VideoStatus>>(new Map())
  const [done, setDone] = useState(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  // 载入配置 + 初始化状态
  useEffect(() => {
    if (!open) return
    setStarted(false)
    setRunning(false)
    setDone(false)
    const init = new Map<number, VideoStatus>()
    postIds.forEach((id) => init.set(id, { postId: id, title: `#${id}`, status: 'pending' }))
    setStatuses(init)
    window.api.settings.getAll().then((s) => {
      setPrompt(s.analysis_prompt || '')
      setModel(s.analysis_model || 'grok-4-fast')
    })
  }, [open, postIds])

  // 订阅进度
  useEffect(() => {
    if (!open) return
    const unsub = window.api.analysis.onProgress((p) => {
      if (p.lastResult) {
        const { postId, ok, title } = p.lastResult
        setStatuses((prev) => {
          const next = new Map(prev)
          next.set(postId, { postId, title, status: ok ? 'success' : 'failed' })
          return next
        })
      }
      if (p.status === 'completed' || p.status === 'stopped' || p.status === 'failed') {
        setRunning(false)
        setDone(true)
        onDoneRef.current?.()
      }
    })
    return unsub
  }, [open])

  const handleStart = async (ids: number[]) => {
    if (!ids.length) return
    try {
      const isRunning = await window.api.analysis.isRunning()
      if (isRunning) {
        toast.error('已有分析任务在进行中，请稍后再试')
        return
      }
      // 先保存可能修改过的配置
      await window.api.settings.set('analysis_prompt', prompt)
      await window.api.settings.set('analysis_model', model)
      setStarted(true)
      setRunning(true)
      setDone(false)
      setStatuses((prev) => {
        const next = new Map(prev)
        ids.forEach((id) => {
          const cur = next.get(id)
          next.set(id, { postId: id, title: cur?.title || `#${id}`, status: 'running' })
        })
        return next
      })
      await window.api.analysis.reanalyzePosts(ids)
    } catch (error) {
      toast.error(`重新标记失败: ${(error as Error).message}`)
      setRunning(false)
    }
  }

  const list = Array.from(statuses.values())
  const success = list.filter((s) => s.status === 'success').length
  const failed = list.filter((s) => s.status === 'failed').length
  const inProgress = list.filter((s) => s.status === 'running').length
  const total = list.length
  const finishedCount = success + failed
  const failedIds = list.filter((s) => s.status === 'failed').map((s) => s.postId)

  return (
    <Dialog open={open} onOpenChange={(o) => (!running ? onOpenChange(o) : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>重新标记进度</DialogTitle>
          <DialogDescription>
            对选中的 {total} 个视频重新进行 AI 标记（仅覆盖 AI 标签，手动标签保留）
          </DialogDescription>
        </DialogHeader>

        {!started ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#6E6E73]">模型</label>
              <Input value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#6E6E73]">分析提示词</label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="h-32 text-xs"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-3">
              <Stat label="总数" value={total} color="#1D1D1F" />
              <Stat label="成功" value={success} color="#34C759" />
              <Stat label="失败" value={failed} color="#FF3B30" />
              <Stat label="进行中" value={inProgress} color="#0A84FF" />
            </div>
            <Progress value={total ? (finishedCount / total) * 100 : 0} />
            <div className="max-h-64 overflow-y-auto rounded-lg border border-[#E5E5E7] divide-y divide-[#F2F2F4]">
              {list.map((s) => (
                <div key={s.postId} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <StatusIcon status={s.status} />
                  <span className="truncate text-[#1D1D1F]">{s.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {!started && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button onClick={() => handleStart(postIds)}>开始重新标记</Button>
            </>
          )}
          {started && done && failedIds.length > 0 && (
            <Button variant="outline" onClick={() => handleStart(failedIds)}>
              <RotateCw className="h-4 w-4 mr-1" />
              重试失败 ({failedIds.length})
            </Button>
          )}
          {started && (
            <Button onClick={() => onOpenChange(false)} disabled={running}>
              {running ? '进行中…' : '完成'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-[#E5E5E7] p-3 text-center">
      <div className="text-xl font-semibold" style={{ color }}>
        {value}
      </div>
      <div className="text-xs text-[#A1A1A6] mt-0.5">{label}</div>
    </div>
  )
}

function StatusIcon({ status }: { status: VideoStatus['status'] }) {
  if (status === 'success') return <CheckCircle2 className="h-4 w-4 text-[#34C759] shrink-0" />
  if (status === 'failed') return <XCircle className="h-4 w-4 text-[#FF3B30] shrink-0" />
  if (status === 'running')
    return <Loader2 className="h-4 w-4 text-[#0A84FF] shrink-0 animate-spin" />
  return <div className="h-4 w-4 rounded-full border border-[#D1D1D6] shrink-0" />
}
