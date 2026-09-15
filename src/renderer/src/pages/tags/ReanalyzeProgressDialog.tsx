import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  CheckCircle2,
  XCircle,
  MinusCircle,
  Loader2,
  RotateCw,
  Pause,
  Play,
  Square
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { AiProviderView, AnalysisJobView } from '@shared/ai'
import { analysisPath } from '@/pages/analysis/shared'

interface ItemState {
  postId: number
  title: string
  status: 'pending' | 'success' | 'failed' | 'skipped'
  error: string | null
}

interface ReanalyzeProgressDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 要重新标记的 postId 列表 */
  postIds: number[]
  /** 有条目完成 / 作业结束时回调（用于刷新列表） */
  onDone?: () => void
}

const DEFAULT_PROVIDER = '__default__'

export function ReanalyzeProgressDialog({
  open,
  onOpenChange,
  postIds,
  onDone
}: ReanalyzeProgressDialogProps): React.JSX.Element {
  const navigate = useNavigate()
  const [providers, setProviders] = useState<AiProviderView[] | null>(null)
  const [providerId, setProviderId] = useState(DEFAULT_PROVIDER)
  const [priority, setPriority] = useState(true)
  const [job, setJob] = useState<AnalysisJobView | null>(null)
  const [items, setItems] = useState<Map<number, ItemState>>(new Map())
  const [starting, setStarting] = useState(false)
  const [acting, setActing] = useState(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    if (!open) return
    setJob(null)
    setProviderId(DEFAULT_PROVIDER)
    setPriority(true)
    const init = new Map<number, ItemState>()
    postIds.forEach((id) =>
      init.set(id, { postId: id, title: `#${id}`, status: 'pending', error: null })
    )
    setItems(init)
    window.api.ai
      .listProviders()
      .then(setProviders)
      .catch((error) => {
        toast.error(`加载提供方失败: ${(error as Error).message}`)
        setProviders([])
      })
  }, [open, postIds])

  // 跟踪本次创建的作业：条目完成逐条更新，作业结束时通知父级刷新
  const jobId = job?.id ?? null
  useEffect(() => {
    if (!open || jobId === null) return
    let finishedNotified = false
    const unsub = window.api.analysis.onQueue((event) => {
      const mine = event.jobs.find((j) => j.id === jobId)
      if (mine) setJob(mine)
      const done = event.itemDone
      if (done && done.jobId === jobId) {
        setItems((prev) => {
          const next = new Map(prev)
          next.set(done.postId, {
            postId: done.postId,
            title: done.title || `#${done.postId}`,
            status: done.ok ? 'success' : 'failed',
            error: done.error
          })
          return next
        })
        onDoneRef.current?.()
      }
      if (mine && !isActive(mine) && !finishedNotified) {
        finishedNotified = true
        // 作品被删 / 作业取消的条目不会有 itemDone，别让它们一直显示为等待
        setItems((prev) => {
          let changed = false
          const next = new Map(prev)
          for (const [id, item] of next) {
            if (item.status === 'pending') {
              next.set(id, { ...item, status: 'skipped' })
              changed = true
            }
          }
          return changed ? next : prev
        })
        onDoneRef.current?.()
      }
    })
    return unsub
  }, [open, jobId])

  const handleStart = async (): Promise<void> => {
    if (!postIds.length) return
    if (providers && !providers.length) {
      onOpenChange(false)
      navigate(analysisPath('providers'))
      return
    }
    setStarting(true)
    try {
      const created = await window.api.analysis.createJob({
        kind: 'reanalyze',
        postIds,
        providerId: providerId === DEFAULT_PROVIDER ? undefined : providerId,
        priority
      })
      setJob(created)
      // 拉一次条目拿到作品标题，之后靠推送逐条更新
      try {
        const { items: rows } = await window.api.analysis.getJobItems(created.id, {
          pageSize: Math.max(postIds.length, 1)
        })
        setItems((prev) => {
          const next = new Map(prev)
          for (const row of rows) {
            const cur = next.get(row.postId)
            if (cur && cur.status === 'pending') {
              next.set(row.postId, {
                ...cur,
                title: row.title || cur.title,
                status:
                  row.status === 'done'
                    ? 'success'
                    : row.status === 'failed'
                      ? 'failed'
                      : 'pending',
                error: row.error
              })
            }
          }
          return next
        })
      } catch (error) {
        console.error('[Reanalyze] 加载作业条目失败:', error)
      }
    } catch (error) {
      toast.error(`重新标记失败: ${(error as Error).message}`)
    } finally {
      setStarting(false)
    }
  }

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setActing(true)
    try {
      await fn()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setActing(false)
    }
  }

  const handleRetryFailed = (): Promise<void> =>
    act(async () => {
      if (!job) return
      const n = await window.api.analysis.retryFailed(job.id)
      if (!n) {
        toast.info('没有可重试的条目')
        return
      }
      setItems((prev) => {
        const next = new Map(prev)
        for (const [id, item] of next) {
          if (item.status === 'failed') next.set(id, { ...item, status: 'pending', error: null })
        }
        return next
      })
    })

  const list = Array.from(items.values())
  const total = list.length
  const success = job?.done ?? 0
  const failed = job?.failed ?? 0
  const finishedCount = success + failed + (job?.skipped ?? 0)
  const running = job ? isActive(job) : false
  const defaultProvider = providers?.find((p) => p.isDefault) ?? providers?.[0]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>重新标记</DialogTitle>
          <DialogDescription>
            对选中的 {total} 个作品重新进行 AI 标记（仅覆盖 AI 标签，手动标签保留）
          </DialogDescription>
        </DialogHeader>

        {!job ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#6E6E73]">提供方</label>
              {providers === null ? (
                <div className="h-9 text-sm text-[#A1A1A6] flex items-center">加载中…</div>
              ) : providers.length ? (
                <Select value={providerId} onValueChange={setProviderId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_PROVIDER}>
                      默认{defaultProvider ? `（${defaultProvider.name}）` : ''}
                    </SelectItem>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} · {p.model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-[#B45309] bg-[#FFFBEB] border border-dashed border-[#F59E0B] rounded-md px-3 py-2">
                  尚未配置 AI 提供方，点「开始」前往配置
                </p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-[#1D1D1F] select-none">
              <input
                type="checkbox"
                checked={priority}
                onChange={(e) => setPriority(e.target.checked)}
                className="h-4 w-4 accent-[#0A84FF]"
              />
              插到队列最前（不等待其它作业）
            </label>
            <p className="text-xs text-[#A1A1A6]">
              使用「视频分析 → 分析设置」中的指令与参数；作业创建后可在视频分析页查看与管理。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-3">
              <Stat label="总数" value={job.total} color="#1D1D1F" />
              <Stat label="成功" value={success} color="#34C759" />
              <Stat label="失败" value={failed} color="#FF3B30" />
              <Stat label="待处理" value={Math.max(0, job.total - finishedCount)} color="#0A84FF" />
            </div>
            <Progress value={job.total ? (finishedCount / job.total) * 100 : 0} />
            {job.status === 'paused' && <p className="text-xs text-[#B45309]">作业已暂停</p>}
            {job.status === 'cancelled' && <p className="text-xs text-[#6E6E73]">作业已取消</p>}
            {job.error && <p className="text-xs text-[#EF4444] break-all">{job.error}</p>}
            <div className="max-h-64 overflow-y-auto rounded-lg border border-[#E5E5E7] divide-y divide-[#F2F2F4]">
              {list.map((s) => (
                <div key={s.postId} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <StatusIcon
                    status={s.status}
                    running={running && job.current.includes(s.title)}
                  />
                  <span className="truncate text-[#1D1D1F]">{s.title}</span>
                  {s.error && (
                    <span className="ml-auto text-[11px] text-[#EF4444] truncate max-w-[40%]">
                      {s.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-between gap-2 pt-2">
          <div className="flex gap-2">
            {job && running && (
              <>
                {job.status === 'paused' ? (
                  <Button
                    variant="outline"
                    disabled={acting}
                    onClick={() => act(() => window.api.analysis.resumeJob(job.id))}
                  >
                    <Play className="h-4 w-4 mr-1" />
                    继续
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    disabled={acting}
                    onClick={() => act(() => window.api.analysis.pauseJob(job.id))}
                  >
                    <Pause className="h-4 w-4 mr-1" />
                    暂停
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={acting}
                  className="text-[#6E6E73] hover:text-[#EF4444]"
                  onClick={() => act(() => window.api.analysis.cancelJob(job.id))}
                >
                  <Square className="h-4 w-4 mr-1" />
                  取消
                </Button>
              </>
            )}
            {job && !running && failed > 0 && (
              <Button variant="outline" onClick={handleRetryFailed} disabled={acting}>
                <RotateCw className="h-4 w-4 mr-1" />
                重试失败 ({failed})
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {!job ? (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={starting}>
                  取消
                </Button>
                <Button onClick={handleStart} disabled={starting || providers === null}>
                  {starting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  开始重新标记
                </Button>
              </>
            ) : (
              <Button onClick={() => onOpenChange(false)}>{running ? '后台运行' : '完成'}</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function isActive(job: AnalysisJobView): boolean {
  return job.status === 'queued' || job.status === 'running' || job.status === 'paused'
}

function Stat({
  label,
  value,
  color
}: {
  label: string
  value: number
  color: string
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-[#E5E5E7] p-3 text-center">
      <div className="text-xl font-semibold" style={{ color }}>
        {value}
      </div>
      <div className="text-xs text-[#A1A1A6] mt-0.5">{label}</div>
    </div>
  )
}

function StatusIcon({
  status,
  running
}: {
  status: ItemState['status']
  running: boolean
}): React.JSX.Element {
  if (status === 'success') return <CheckCircle2 className="h-4 w-4 text-[#34C759] shrink-0" />
  if (status === 'failed') return <XCircle className="h-4 w-4 text-[#FF3B30] shrink-0" />
  if (status === 'skipped') return <MinusCircle className="h-4 w-4 text-[#A1A1A6] shrink-0" />
  if (running) return <Loader2 className="h-4 w-4 text-[#0A84FF] shrink-0 animate-spin" />
  return <div className="h-4 w-4 rounded-full border border-[#D1D1D6] shrink-0" />
}
