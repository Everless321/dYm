import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, ExternalLink, RotateCw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatUnixTime } from '@/lib/format'
import type { AnalysisJobItemStatus, AnalysisJobItemView, AnalysisJobView } from '@shared/ai'
import { ITEM_STATUS_META, JOB_STATUS_META, jobProgress } from './shared'

interface JobDetailDialogProps {
  job: AnalysisJobView | null
  onOpenChange: (open: boolean) => void
}

const PAGE_SIZE = 50
type Filter = 'all' | AnalysisJobItemStatus

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'failed', label: '失败' },
  { value: 'done', label: '成功' },
  { value: 'pending', label: '等待' },
  { value: 'running', label: '分析中' },
  { value: 'skipped', label: '跳过' }
]

export function JobDetailDialog({ job, onOpenChange }: JobDetailDialogProps): React.JSX.Element {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<AnalysisJobItemView[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const jobId = job?.id ?? null
  // 作业进度变化（done/failed 计数）时刷新当前页，用这几个数做依赖而不是整个对象
  const progressKey = job ? `${job.done}:${job.failed}:${job.skipped}:${job.status}` : ''

  useEffect(() => {
    setFilter('all')
    setPage(1)
  }, [jobId])

  const load = useCallback(async () => {
    if (jobId === null) return
    setLoading(true)
    try {
      const result = await window.api.analysis.getJobItems(jobId, {
        status: filter === 'all' ? undefined : filter,
        page,
        pageSize: PAGE_SIZE
      })
      setItems(result.items)
      setTotal(result.total)
    } catch (error) {
      toast.error(`加载条目失败: ${(error as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [jobId, filter, page])

  useEffect(() => {
    load()
    // progressKey 只作为触发刷新的信号
  }, [load, progressKey])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const handleRetry = async (): Promise<void> => {
    if (jobId === null) return
    setRetrying(true)
    try {
      const count = await window.api.analysis.retryFailed(jobId)
      toast.success(count ? `${count} 条失败作品已重新排队` : '没有可重试的条目')
    } catch (error) {
      toast.error(`重试失败: ${(error as Error).message}`)
    } finally {
      setRetrying(false)
    }
  }

  const open = job !== null
  const meta = job ? JOB_STATUS_META[job.status] : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="truncate">{job?.name ?? ''}</span>
            {meta && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0"
                style={{ color: meta.color, backgroundColor: meta.bg }}
              >
                {meta.label}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {job && (
              <>
                {job.providerName ?? '默认提供方'} · 创建于 {formatUnixTime(job.createdAt)}
                {job.finishedAt ? ` · 结束于 ${formatUnixTime(job.finishedAt)}` : ''}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {job && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-[#6E6E73]">
                <span>
                  成功 <b className="text-[#22C55E]">{job.done}</b> · 失败{' '}
                  <b className="text-[#EF4444]">{job.failed}</b>
                  {job.skipped > 0 && (
                    <>
                      {' '}
                      · 跳过 <b>{job.skipped}</b>
                    </>
                  )}{' '}
                  · 共 {job.total}
                </span>
                <span className="tabular-nums">{jobProgress(job)}%</span>
              </div>
              <Progress value={jobProgress(job)} />
              {job.error && (
                <p className="text-xs text-[#EF4444] bg-[#FEE2E2] rounded-md px-3 py-2 break-all">
                  {job.error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 mt-2">
              <div className="flex gap-1 flex-wrap">
                {FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => {
                      setFilter(f.value)
                      setPage(1)
                    }}
                    className={`h-7 px-2.5 rounded-md text-xs transition-colors ${
                      filter === f.value
                        ? 'bg-[#1D1D1F] text-white'
                        : 'bg-[#F2F2F4] text-[#6E6E73] hover:bg-[#E8E8ED]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              {job.failed > 0 && (
                <Button size="sm" variant="outline" onClick={handleRetry} disabled={retrying}>
                  <RotateCw className={`h-3.5 w-3.5 mr-1 ${retrying ? 'animate-spin' : ''}`} />
                  重试失败 ({job.failed})
                </Button>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-[#E5E5E7] divide-y divide-[#F2F2F4]">
              {items.length === 0 ? (
                <div className="py-10 text-center text-sm text-[#A1A1A6]">
                  {loading ? '加载中…' : '没有条目'}
                </div>
              ) : (
                items.map((item) => {
                  const s = ITEM_STATUS_META[item.status]
                  return (
                    <div
                      key={item.postId}
                      className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-[#FAFAFA]"
                    >
                      <span
                        className="w-12 shrink-0 text-[11px] font-medium"
                        style={{ color: s.color }}
                      >
                        {s.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-[#1D1D1F]">{item.title || `#${item.postId}`}</p>
                        <p className="text-[11px] text-[#A1A1A6] truncate">
                          {item.nickname}
                          {item.attempts > 1 ? ` · 第 ${item.attempts} 次` : ''}
                          {item.error ? ` · ${item.error}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        title="打开作品标签页"
                        onClick={() => {
                          onOpenChange(false)
                          navigate(`/tags/video/${item.postId}`)
                        }}
                        className="shrink-0 text-[#A1A1A6] hover:text-[#0A84FF]"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </button>
                    </div>
                  )
                })
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-end gap-2 text-xs text-[#6E6E73]">
                <span className="tabular-nums">
                  {page} / {totalPages}
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
