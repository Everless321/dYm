import { NavLink, Outlet } from 'react-router-dom'

const tabs = [
  { to: '/library/videos', label: '视频' },
  { to: '/library/tags', label: '标签' },
  { to: '/library/jobs', label: '分析任务' }
]

export function LibraryLayout(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-8 py-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">内容库</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            管理已下载的视频、标签与分析任务
          </p>
        </div>
        <nav className="flex items-center gap-1 rounded-lg bg-[var(--surface-muted)] p-1">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-[var(--surface)] font-medium text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`
              }
            >
              {tab.label}
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
