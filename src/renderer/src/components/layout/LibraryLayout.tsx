import { NavLink, Outlet } from 'react-router-dom'

const tabs = [
  { to: '/library/videos', label: '视频' },
  { to: '/library/tags', label: '标签库' },
  { to: '/library/jobs', label: '分析队列' }
]

export function LibraryLayout(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      <header className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] px-6 pt-4">
        <h1 className="text-xl font-semibold tracking-tight text-[var(--text-primary)]">内容库</h1>
        <nav className="mt-4 flex items-center gap-6">
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
