import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Pause, Play, Square, RotateCw, Trash2, ListChecks, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatUnixTime, formatDuration } from '@/lib/format'
import type { AnalysisJobView } from '@shared/ai'
import { JOB_STATUS_META, isJobActive, jobProgress } from './shared'
import { JobDetailDialog } from './JobDetailDialog'

interface JobsPanelProps {
  jobs: AnalysisJobView[] | null
  totals: TotalAnalysisStats | null
  onCreate: () => void
}

export function JobsPanel({ jobs, totals, onCreate }: JobsPanelProps): React.JSX.Element {
  const [detailId, setDetailId] = useState<number | null>(null)
  const [busy, setBusy] = useState<Record<number, boolean>>({})
  const [clearing, setClearing] = useState(false)

  const { active, finished } = useMemo(() => {
    const list = jobs ?? []
    return {
      active: list.filter(isJobActive),
      finished: list.filter((j) => !isJobActive(j))
    }
  }, [jobs])

  const detailJob = jobs?.find((j) => j.id === detailId) ?? null

  const run = async (id: number, fn: () => Promise<unknown>, okMessage?: string): Promise<void> => {
    setBusy((prev) => ({ ...prev, [id]: true }))
    try {
      await fn()
      if (okMessage) toast.success(okMessage)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  const handleClearFinished = async (): Promise<void> => {
    if (!finished.length) return
    if (!window.confirm(`清除 ${finished.length} 条已结束的作业记录？分析结果不受影响。`)) return
    setClearing(true)
    try {
      const results = await Promise.allSettled(
        finished.map((j) => window.api.analysis.deleteJob(j.id))
      )
      const failed = results.filter((r) => r.status === 'rejected').length
      if (failed) toast.error(`${failed} 条清除失败`)
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="待分析" value={totals?.unanalyzed ?? null} color="#0A84FF" />
        <Stat label="已分析" value={totals?.analyzed ?? null} color="#22C55E" />
        <Stat label="进行中的作业" value={jobs ? active.length : null} color="#F59E0B" />
        <Stat label="作品总数" value={totals?.total ?? null} color="#1D1D1F" />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#1D1D1F]">队列</h3>
          <span className="text-xs text-[#A1A1A6]">{active.length} 个作业</span>
        </div>
        {jobs === null ? (
          <div className="py-10 text-center text-sm text-[#A1A1A6]">加载中…</div>
        ) : active.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#D1D1D6] bg-white py-12 text-center">
            <ListChecks className="h-10 w-10 text-[#E5E5E7] mx-auto mb-3" />
            <p className="text-sm text-[#6E6E73]">队列是空的</p>
            <p className="text-xs text-[#A1A1A6] mt-1 mb-4">
              {totals?.unanalyzed
                ? `还有 ${totals.unanalyzed.toLocaleString()} 条作品没有分析`
                : '所有作品都已分析'}
            </p>
            <Button variant="outline" onClick={onCreate}>
              新建分析作业
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {active.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                busy={!!busy[job.id]}
                onOpen={() => setDetailId(job.id)}
                onPause={() => run(job.id, () => window.api.analysis.pauseJob(job.id))}
                onResume={() => run(job.id, () => window.api.analysis.resumeJob(job.id))}
                onCancel={() => {
                  if (!window.confirm(`取消作业「${job.name}」？已完成的条目会保留。`)) return
                  run(job.id, () => window.api.analysis.cancelJob(job.id))
                }}
              />
            ))}
          </div>
        )}
      </section>

      {finished.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-[#1D1D1F]">历史</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleClearFinished}
              disabled={clearing}
              className="text-[#6E6E73]"
            >
              {clearing ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1" />
              )}
              清除已结束
            </Button>
          </div>
          <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm divide-y divide-[#F2F2F4]">
            {finished.map((job) => {
              const meta = JOB_STATUS_META[job.status]
              return (
                <div
                  key={job.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[#FAFAFA] cursor-pointer"
                  onClick={() => setDetailId(job.id)}
                >
                  <span
                    className="text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 w-16 text-center"
                    style={{ color: meta.color, backgroundColor: meta.bg }}
                  >
                    {meta.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#1D1D1F] truncate">{job.name}</p>
                    <p className="text-[11px] text-[#A1A1A6] mt-0.5">
                      {job.providerName ?? '默认提供方'} · {formatUnixTime(job.createdAt)}
                      {job.startedAt && job.finishedAt
                        ? ` · 用时 ${formatDuration(job.startedAt, job.finishedAt)}`
                        : ''}
                    </p>
                  </div>
                  <span className="text-xs text-[#6E6E73] tabular-nums shrink-0">
                    <span className="text-[#22C55E]">{job.done}</span>
                    {job.failed > 0 && (
                      <>
                        {' / '}
                        <span className="text-[#EF4444]">{job.failed}</span>
                      </>
                    )}
                    {' / '}
                    {job.total}
                  </span>
                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {job.failed > 0 && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title="重试失败条目"
                        disabled={!!busy[job.id]}
                        onClick={() =>
                          run(
                            job.id,
                            async () => {
                              const n = await window.api.analysis.retryFailed(job.id)
                              if (!n) throw new Error('没有可重试的条目')
                            },
                            '失败条目已重新排队'
                          )
                        }
                      >
                        <RotateCw className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-[#A1A1A6] hover:text-[#EF4444]"
                      title="删除记录"
                      disabled={!!busy[job.id]}
                      onClick={() => run(job.id, () => window.api.analysis.deleteJob(job.id))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <JobDetailDialog job={detailJob} onOpenChange={(o) => !o && setDetailId(null)} />
    </div>
  )
}

function Stat({
  label,
  value,
  color
}: {
  label: string
  value: number | null
  color: string
}): React.JSX.Element {
  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-black/[0.04] px-5 py-4">
      <div className="text-xs text-[#A1A1A6]">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1.5" style={{ color }}>
        {value === null ? '—' : value.toLocaleString()}
      </div>
    </div>
  )
}

function JobCard({
  job,
  busy,
  onOpen,
  onPause,
  onResume,
  onCancel
}: {
  job: AnalysisJobView
  busy: boolean
  onOpen: () => void
  onPause: () => void
  onResume: () => void
  onCancel: () => void
}): React.JSX.Element {
  const meta = JOB_STATUS_META[job.status]
  const percent = jobProgress(job)
  const finishedCount = job.done + job.failed + job.skipped
  return (
    <div
      className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-5 cursor-pointer hover:border-[#D1D1D6] transition-colors"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0"
              style={{ color: meta.color, backgroundColor: meta.bg }}
            >
              {meta.label}
            </span>
            <p className="text-sm font-semibold text-[#1D1D1F] truncate">{job.name}</p>
          </div>
          <p className="text-[11px] text-[#A1A1A6] mt-1">
            {job.providerName ?? '默认提供方'} · 创建于 {formatUnixTime(job.createdAt)}
            {job.startedAt ? ` · 已运行 ${formatDuration(job.startedAt, job.finishedAt)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {job.status === 'paused' ? (
            <Button size="sm" variant="outline" onClick={onResume} disabled={busy}>
              <Play className="h-3.5 w-3.5 mr-1" />
              继续
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onPause} disabled={busy}>
              <Pause className="h-3.5 w-3.5 mr-1" />
              暂停
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
            className="text-[#6E6E73] hover:text-[#EF4444]"
          >
            <Square className="h-3.5 w-3.5 mr-1" />
            取消
          </Button>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-[#6E6E73]">
            <span className="text-[#22C55E]">成功 {job.done}</span>
            <span className="mx-1.5 text-[#D1D1D6]">·</span>
            <span className="text-[#EF4444]">失败 {job.failed}</span>
            {job.skipped > 0 && (
              <>
                <span className="mx-1.5 text-[#D1D1D6]">·</span>
                <span>跳过 {job.skipped}</span>
              </>
            )}
          </span>
          <span className="font-mono text-[#1D1D1F]">
            {finishedCount}/{job.total} · {percent}%
          </span>
        </div>
        <div className="h-2 bg-[#F2F2F4] rounded-full overflow-hidden">
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${percent}%`, backgroundColor: meta.color }}
          />
        </div>
        {job.current.length > 0 && (
          <div className="mt-2.5 flex items-center gap-2 text-xs text-[#6E6E73]">
            <Loader2 className="h-3 w-3 animate-spin shrink-0 text-[#0A84FF]" />
            <span className="truncate">{job.current.join('　|　')}</span>
          </div>
        )}
        {job.error && <p className="mt-2 text-xs text-[#EF4444] break-all">{job.error}</p>}
      </div>
    </div>
  )
}
