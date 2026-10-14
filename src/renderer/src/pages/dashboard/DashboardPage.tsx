import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  BellDot,
  CheckCircle2,
  CircleDot,
  Radio,
  RefreshCw,
  Sparkles
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import type { AnalysisJobView } from '@shared/ai'
import { formatBytes } from '@/lib/format'
import { isJobActive, jobProgress } from '@/pages/analysis/shared'

type ActivityKind = 'sync' | 'live' | 'system'
type ActivityFilter = 'all' | 'sync' | 'live' | 'error'

interface ActivityItem {
  id: string
  timestamp: number
  kind: ActivityKind
  error: boolean
  title: string
  detail?: string
}

interface LiveActivity extends LiveProgress {
  timestamp: number
}

const activityFilters: { value: ActivityFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'sync', label: '同步' },
  { value: 'live', label: '直播' },
  { value: 'error', label: '错误' }
]

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

function formatActivityTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function ChartCard({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">近 30 天下载</h2>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">每日新增视频数量</p>
        </div>
        <ArrowDownToLine size={16} className="text-[var(--text-tertiary)]" />
      </div>
      {children}
    </section>
  )
}

export default function DashboardPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [users, setUsers] = useState<DbUser[] | null>(null)
  const [storageBytes, setStorageBytes] = useState<number | null>(null)
  const [tasks, setTasks] = useState<DbTaskWithUsers[]>([])
  const [runningTaskIds, setRunningTaskIds] = useState<Set<number>>(new Set())
  const [downloadProgress, setDownloadProgress] = useState<Map<number, DownloadProgress>>(new Map())
  const [recordingIds, setRecordingIds] = useState<number[]>([])
  const [liveRecords, setLiveRecords] = useState<LiveRecord[]>([])
  const [liveEvents, setLiveEvents] = useState<LiveActivity[]>([])
  const [jobs, setJobs] = useState<AnalysisJobView[]>([])
  const [unanalyzedCount, setUnanalyzedCount] = useState<number | null>(null)
  const [logs, setLogs] = useState<SchedulerLog[]>([])
  const [cookieConfigured, setCookieConfigured] = useState<boolean | null>(null)
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [loading, setLoading] = useState(true)

  const refreshTasks = useCallback(async (): Promise<void> => {
    try {
      const nextTasks = await window.api.task.getAll()
      setTasks(nextTasks)
      const running = await Promise.all(
        nextTasks
          .filter((task) => task.status === 'running')
          .map(async (task) => [task.id, await window.api.download.isRunning(task.id)] as const)
      )
      setRunningTaskIds(new Set(running.filter(([, isRunning]) => isRunning).map(([id]) => id)))
    } catch {
      setTasks([])
      setRunningTaskIds(new Set())
    }
  }, [])

  const refreshLive = useCallback(async (): Promise<void> => {
    try {
      const [ids, records] = await Promise.all([
        window.api.live.getRecordingUsers(),
        window.api.live.getRecords(20)
      ])
      setRecordingIds(ids)
      setLiveRecords(records)
    } catch {
      setRecordingIds([])
    }
  }, [])

  const loadDashboard = useCallback(async (): Promise<void> => {
    setLoading(true)
    const [
      overviewResult,
      trendResult,
      usersResult,
      jobsResult,
      countResult,
      logsResult,
      cookieResult
    ] = await Promise.allSettled([
      window.api.dashboard.getOverview(),
      window.api.dashboard.getDownloadTrend(30),
      window.api.user.getAll(),
      window.api.analysis.listJobs(),
      window.api.analysis.getUnanalyzedCount(),
      window.api.scheduler.getLogs(),
      window.api.settings.get('douyin_cookie')
    ])

    if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value)
    if (trendResult.status === 'fulfilled') setTrend(trendResult.value)
    if (usersResult.status === 'fulfilled') {
      const creatorList = usersResult.value ?? []
      setUsers(creatorList)
      const queue = [...creatorList]
      let totalSize = 0
      const worker = async (): Promise<void> => {
        while (queue.length > 0) {
          const creator = queue.shift()
          if (!creator) return
          try {
            const sizes = await window.api.files.getFileSizes(creator.sec_uid)
            totalSize += sizes?.totalSize ?? 0
          } catch {
            // A creator without a readable local folder contributes no measured bytes.
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, creatorList.length) }, worker))
      setStorageBytes(totalSize)
    }
    if (jobsResult.status === 'fulfilled') setJobs(jobsResult.value)
    if (countResult.status === 'fulfilled') setUnanalyzedCount(countResult.value)
    if (logsResult.status === 'fulfilled') setLogs(logsResult.value)
    if (cookieResult.status === 'fulfilled') setCookieConfigured(Boolean(cookieResult.value))

    await Promise.all([refreshTasks(), refreshLive()])
    setLoading(false)
  }, [refreshLive, refreshTasks])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDashboard(), 0)
    const unsubscribeLog = window.api.scheduler.onLog((log) =>
      setLogs((current) => [log, ...current].slice(0, 100))
    )
    const unsubscribeDownload = window.api.download.onProgress((progress) => {
      setDownloadProgress((current) => {
        const next = new Map(current)
        if (progress.status === 'running') next.set(progress.taskId, progress)
        else next.delete(progress.taskId)
        return next
      })
      if (progress.status === 'running') {
        setRunningTaskIds((current) => new Set(current).add(progress.taskId))
      } else {
        setRunningTaskIds((current) => {
          const next = new Set(current)
          next.delete(progress.taskId)
          return next
        })
        void refreshTasks()
      }
    })
    const unsubscribeLive = window.api.live.onProgress((progress) => {
      setLiveEvents((current) => [{ ...progress, timestamp: Date.now() }, ...current].slice(0, 30))
      void refreshLive()
    })
    const unsubscribeAnalysis = window.api.analysis.onQueue((event) => setJobs(event.jobs))
    return () => {
      window.clearTimeout(timer)
      unsubscribeLog()
      unsubscribeDownload()
      unsubscribeLive()
      unsubscribeAnalysis()
    }
  }, [loadDashboard, refreshLive, refreshTasks])

  const failedTasks = tasks.filter((task) => task.status === 'failed')
  const runningTasks = tasks.filter((task) => runningTaskIds.has(task.id))
  const activeJobs = jobs.filter(isJobActive)
  const recordings = users?.filter((user) => recordingIds.includes(user.id)) ?? []
  const analysisPercent =
    overview && overview.totalPosts > 0
      ? Math.round((overview.analyzedPosts / overview.totalPosts) * 100)
      : 0

  const activities = useMemo((): ActivityItem[] => {
    const logItems = logs.map(
      (log, index): ActivityItem => ({
        id: `log-${log.timestamp}-${index}`,
        timestamp: log.timestamp,
        kind: log.type === 'user' || log.type === 'task' ? 'sync' : 'system',
        error: log.level === 'error',
        title: log.message,
        detail: log.targetName
      })
    )
    const recordItems = liveRecords.map(
      (record): ActivityItem => ({
        id: `record-${record.id}`,
        timestamp: record.started_at * 1000,
        kind: 'live',
        error: record.status === 'failed',
        title: `${record.nickname || '创作者'}${record.status === 'recording' ? '开始直播录制' : record.status === 'failed' ? '直播录制失败' : '直播录制结束'}`,
        detail: record.title || undefined
      })
    )
    const eventItems = liveEvents.map(
      (event, index): ActivityItem => ({
        id: `live-event-${event.userId}-${event.timestamp}-${index}`,
        timestamp: event.timestamp,
        kind: 'live',
        error: event.status === 'failed' || event.status === 'convert-failed',
        title: `${event.nickname}${event.status === 'recording' ? '开始录制' : event.status === 'failed' || event.status === 'convert-failed' ? '录制失败' : '录制状态更新'}`,
        detail: event.message || undefined
      })
    )
    return [...logItems, ...recordItems, ...eventItems].sort((a, b) => b.timestamp - a.timestamp)
  }, [liveEvents, liveRecords, logs])

  const visibleActivities = activities
    .filter((item) => {
      if (filter === 'all') return true
      if (filter === 'error') return item.error
      if (filter === 'sync') return item.kind === 'sync' && !item.error
      return item.kind === 'live'
    })
    .slice(0, 8)

  const attentionCount =
    (cookieConfigured === false ? 1 : 0) +
    failedTasks.length +
    (unanalyzedCount && unanalyzedCount > 0 ? 1 : 0)
  const activityErrorCount = activities.filter((item) => item.error).length
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const yesterdayStart = new Date(todayStart)
  yesterdayStart.setDate(yesterdayStart.getDate() - 1)
  const todayActivities = visibleActivities.filter((item) => item.timestamp >= todayStart.getTime())
  const yesterdayActivities = visibleActivities.filter(
    (item) => item.timestamp >= yesterdayStart.getTime() && item.timestamp < todayStart.getTime()
  )

  const retryFailedTasks = async (): Promise<void> => {
    try {
      await Promise.all(failedTasks.map((task) => window.api.download.start(task.id)))
      toast.success(`已重试 ${failedTasks.length} 个下载任务`)
      void refreshTasks()
    } catch (error) {
      toast.error(`重试失败：${(error as Error).message}`)
    }
  }

  const trendData = trend.map((point) => ({ ...point, label: point.date.slice(5) }))
  const dayLabel = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  }).format(new Date())

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[1600px] flex-col gap-5 px-8 py-7">
        <header className="flex flex-wrap items-end justify-between gap-8">
          <div className="min-w-0">
            <p className="text-[13px] text-[var(--text-secondary)]">{dayLabel}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {attentionCount === 0 && !loading
                ? `${greeting()}，一切正常`
                : `${greeting()}，今天有 ${loading ? '…' : attentionCount} 件事需要你处理`}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-7">
            {overview && (
              <>
                <HeaderStat label="创作者" value={overview.totalUsers.toLocaleString()} />
                <HeaderStat label="视频" value={overview.totalPosts.toLocaleString()} separated />
                <HeaderStat
                  label="已分析"
                  value={overview.analyzedPosts.toLocaleString()}
                  suffix={`${analysisPercent}%`}
                  separated
                />
                {storageBytes !== null && (
                  <HeaderStat
                    label="占用"
                    value={formatBytes(storageBytes).replace(/\s*[A-Z]+$/, '')}
                    suffix={formatBytes(storageBytes).match(/[A-Z]+$/)?.[0]}
                    separated
                  />
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => void loadDashboard()}
              disabled={loading}
              aria-label="刷新概览"
              className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--surface-muted)] disabled:opacity-50"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </header>

        {attentionCount > 0 && (
          <section className="flex flex-wrap items-center rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex h-[52px] items-center gap-2 px-4">
              <BellDot size={16} />
              <h2 className="text-[13px] font-semibold">需要处理</h2>
            </div>
            <div className="h-6 w-px bg-[var(--border)]" />
            <div className="flex min-w-0 flex-1 flex-wrap items-center">
              {cookieConfigured === false && (
                <AttentionItem
                  icon={AlertCircle}
                  tone="warning"
                  title="尚未配置 Cookie"
                  description="配置后即可同步 Douyin 内容"
                  action="去设置"
                  onClick={() => navigate('/settings/account')}
                />
              )}
              {failedTasks.length > 0 && (
                <AttentionItem
                  icon={AlertCircle}
                  tone="danger"
                  title={`${failedTasks.length} 个下载任务失败`}
                  description="可重新启动失败任务"
                  action="全部重试"
                  onClick={() => void retryFailedTasks()}
                />
              )}
              {unanalyzedCount !== null && unanalyzedCount > 0 && (
                <AttentionItem
                  icon={Sparkles}
                  tone="accent"
                  title={`${unanalyzedCount} 条视频待 AI 分析`}
                  description="为尚未分析的作品创建任务"
                  action="开始分析"
                  onClick={() => navigate('/library/jobs', { state: { openNewJob: true } })}
                />
              )}
            </div>
          </section>
        )}

        <div className="grid min-h-[540px] grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.88fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">正在进行</h2>
                  <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
                    {recordings.length + runningTasks.length + activeJobs.length}
                  </span>
                </div>
                <Activity size={16} className="text-[var(--text-tertiary)]" />
              </div>
              <div className="space-y-3">
                {recordings.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center gap-3 rounded-lg bg-[var(--surface-muted)] px-3.5 py-3"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--danger-soft)] text-[var(--live)]">
                      <Radio size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{user.nickname}</p>
                      <p className="text-xs text-[var(--text-secondary)]">直播录制中</p>
                    </div>
                    <span className="rounded-full bg-[var(--danger-soft)] px-2 py-1 text-[10px] font-medium text-[var(--live)]">
                      LIVE
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void window.api.live.stop(user.id).then(() => void refreshLive())
                      }
                      className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      停止
                    </button>
                  </div>
                ))}
                {runningTasks.map((task) => {
                  const progress = downloadProgress.get(task.id)
                  const done = progress?.downloadedPosts ?? task.downloaded_videos
                  const total = progress?.totalVideos ?? task.total_videos
                  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
                  return (
                    <div key={task.id} className="rounded-lg bg-[var(--surface-muted)] px-3.5 py-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium">{task.name}</span>
                        <span className="font-mono text-xs text-[var(--text-secondary)]">
                          {total > 0 ? `${percent}%` : '进行中'}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                        <div
                          className="h-full rounded-full bg-[var(--accent)] transition-[width]"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-[var(--text-tertiary)]">
                        {progress?.currentUser || `${done} / ${total} 条视频`}
                      </p>
                    </div>
                  )
                })}
                {activeJobs.map((job) => (
                  <div key={job.id} className="rounded-lg bg-[var(--surface-muted)] px-3.5 py-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium">{job.name}</span>
                      <span className="font-mono text-xs text-[var(--text-secondary)]">
                        {jobProgress(job)}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                      <div
                        className="h-full rounded-full bg-[var(--success)]"
                        style={{ width: `${jobProgress(job)}%` }}
                      />
                    </div>
                    <p className="mt-1.5 truncate text-xs text-[var(--text-tertiary)]">
                      {job.current.slice(0, 2).join(' · ') || `${job.done} / ${job.total} 条视频`}
                    </p>
                  </div>
                ))}
                {recordings.length + runningTasks.length + activeJobs.length === 0 && (
                  <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-muted)] px-3 py-3 text-xs text-[var(--text-tertiary)]">
                    <CheckCircle2 size={15} className="text-[var(--success)]" />
                    目前没有正在进行的任务
                  </div>
                )}
              </div>
            </section>

            <ChartCard>
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={trendData} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      interval={4}
                      tick={{ fill: '#A1A1A6', fontSize: 10 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#A1A1A6', fontSize: 10 }}
                    />
                    <Tooltip
                      cursor={{ fill: '#F2F2F4' }}
                      contentStyle={{
                        borderRadius: 8,
                        border: '1px solid #E5E5E7',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                        fontSize: 12
                      }}
                      formatter={(value) => [`${value ?? 0} 条`, '下载']}
                    />
                    <Bar dataKey="count" fill="#0A84FF" radius={[3, 3, 0, 0]} maxBarSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-[250px] items-center justify-center text-sm text-[var(--text-tertiary)]">
                  暂无下载记录
                </div>
              )}
            </ChartCard>
          </div>

          <section className="flex min-h-0 flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="text-sm font-semibold">最近动态</h2>
            <div className="mt-3 flex gap-0.5 rounded-md bg-[var(--surface-muted)] p-0.5">
              {activityFilters.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setFilter(item.value)}
                  className={`flex-1 rounded px-2 py-1.5 text-xs transition-colors ${
                    filter === item.value
                      ? 'bg-[var(--surface)] font-medium text-[var(--text-primary)] shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {item.value === 'error' ? `${item.label} · ${activityErrorCount}` : item.label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {todayActivities.length > 0 && <ActivityGroup label="今天" items={todayActivities} />}
              {yesterdayActivities.length > 0 && (
                <ActivityGroup label="昨天" items={yesterdayActivities} />
              )}
              {todayActivities.length + yesterdayActivities.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 text-center text-sm text-[var(--text-tertiary)]">
                  <CheckCircle2 size={20} className="text-[var(--success)]" />
                  暂无动态
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2 border-t border-[var(--border)] pt-3 text-xs">
              <span className="flex-1 text-[var(--text-tertiary)]">原「同步日志」已合并至此</span>
              <Link to="/logs" className="text-[var(--accent)] hover:underline">
                查看全部 {activities.length} 条
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function HeaderStat({
  label,
  value,
  suffix,
  separated = false
}: {
  label: string
  value: string
  suffix?: string
  separated?: boolean
}): React.JSX.Element {
  return (
    <div
      className={`flex flex-col gap-0.5 ${separated ? 'border-l border-[var(--border)] pl-7' : ''}`}
    >
      <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      <span className="flex items-baseline gap-1 font-mono text-[22px] font-semibold leading-7 tracking-tight">
        {value}
        {suffix && (
          <span className="text-xs font-normal text-[var(--text-tertiary)]">{suffix}</span>
        )}
      </span>
    </div>
  )
}

function ActivityGroup({
  label,
  items
}: {
  label: string
  items: ActivityItem[]
}): React.JSX.Element {
  return (
    <section>
      <h3 className="pb-1 pt-3 text-[11px] font-semibold tracking-wide text-[var(--text-tertiary)]">
        {label}
      </h3>
      <div className="divide-y divide-[var(--border)]/70">
        {items.map((item) => (
          <div key={item.id} className="flex gap-3 py-2.5">
            <span
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                item.error
                  ? 'bg-[var(--danger-soft)] text-[var(--danger)]'
                  : item.kind === 'live'
                    ? 'bg-[var(--danger-soft)] text-[var(--live)]'
                    : item.kind === 'sync'
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'bg-[var(--surface-muted)] text-[var(--text-secondary)]'
              }`}
            >
              {item.error ? (
                <AlertCircle size={14} />
              ) : item.kind === 'live' ? (
                <Radio size={14} />
              ) : item.kind === 'sync' ? (
                <RefreshCw size={14} />
              ) : (
                <CircleDot size={14} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-medium leading-5">{item.title}</p>
                <time className="shrink-0 font-mono text-[10px] text-[var(--text-tertiary)]">
                  {formatActivityTime(item.timestamp)}
                </time>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
                {item.detail ||
                  (item.kind === 'sync'
                    ? '同步事件'
                    : item.kind === 'live'
                      ? '直播录制'
                      : '系统事件')}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function AttentionItem({
  icon: Icon,
  tone,
  title,
  description,
  action,
  onClick
}: {
  icon: LucideIcon
  tone: 'warning' | 'danger' | 'accent'
  title: string
  description: string
  action: string
  onClick: () => void
}): React.JSX.Element {
  const toneClasses = {
    warning: 'bg-[var(--warning-soft)] text-[var(--warning)]',
    danger: 'bg-[var(--danger-soft)] text-[var(--danger)]',
    accent: 'bg-[var(--accent-soft)] text-[var(--accent)]'
  }[tone]
  return (
    <div className="flex min-w-[250px] flex-1 items-center gap-2.5 border-l border-[var(--border)] px-3.5 py-2 first:border-l-0">
      <span
        className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full ${toneClasses}`}
      >
        <Icon size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{title}</p>
        <p className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">{description}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-semibold ${toneClasses}`}
      >
        {action}
      </button>
    </div>
  )
}
