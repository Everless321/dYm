import { NavLink, Outlet } from 'react-router-dom'

export function CreatorsLayout(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-8 py-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">创作者</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">创作者主页与本地视频文件</p>
        </div>
        <nav className="flex items-center gap-1 rounded-lg bg-[var(--surface-muted)] p-1">
          <NavLink
            end
            to="/creators"
            className={({ isActive }) =>
              `rounded-md px-3 py-1.5 text-sm ${
                isActive
                  ? 'bg-[var(--surface)] font-medium text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`
            }
          >
            创作者
          </NavLink>
          <NavLink
            to="/creators/files"
            className={({ isActive }) =>
              `rounded-md px-3 py-1.5 text-sm ${
                isActive
                  ? 'bg-[var(--surface)] font-medium text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`
            }
          >
            文件
          </NavLink>
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  )
}
