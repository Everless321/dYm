import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import type { AnalysisJobView } from '@shared/ai'

interface LibraryCounts {
  videos: number
  tagged: number
  tags: number
  runningJobs: number
}

export function LibraryLayout(): React.JSX.Element {
  const [counts, setCounts] = useState<LibraryCounts>({
    videos: 0,
    tagged: 0,
    tags: 0,
    runningJobs: 0
  })

  useEffect(() => {
    void Promise.all([window.api.tag.getOverviewStats(), window.api.tag.getLibraryStats()])
      .then(([videos, tags]) =>
        setCounts((current) => ({
          ...current,
          videos: videos.totalVideos,
          tagged: videos.tagged,
          tags: tags.totalTags
        }))
      )
      .catch((error) => console.error('[LibraryLayout] 加载计数失败:', error))

    const updateJobs = (jobs: AnalysisJobView[]): void => {
      setCounts((current) => ({
        ...current,
        runningJobs: jobs.filter((job) => ['queued', 'running', 'paused'].includes(job.status))
          .length
      }))
    }
    void window.api.analysis
      .listJobs()
      .then(updateJobs)
      .catch((error) => console.error('[LibraryLayout] 加载作业计数失败:', error))
    return window.api.analysis.onQueue((event) => updateJobs(event.jobs))
  }, [])

  const tabs = [
    { to: '/library/videos', label: '视频', count: counts.videos },
    { to: '/library/tags', label: '标签库', count: counts.tags },
    { to: '/library/jobs', label: '分析队列', count: counts.runningJobs, accent: true }
  ]

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      <header className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-6 pt-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">
            内容库
          </h1>
          <span className="text-xs text-[var(--text-tertiary)]">
            {counts.videos.toLocaleString()} 个视频 · 已标记 {counts.tagged.toLocaleString()}
          </span>
        </div>
        <nav className="mt-3 flex items-center gap-5">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `border-b-2 px-0.5 pb-3 text-sm transition-colors ${
                  isActive
                    ? 'border-[var(--text-primary)] font-semibold text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`
              }
            >
              <span>{tab.label}</span>
              {tab.count > 0 && (
                <span
                  className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
                    tab.accent
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--surface-muted)] text-[var(--text-tertiary)]'
                  }`}
                >
                  {tab.count.toLocaleString()}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  )
}
