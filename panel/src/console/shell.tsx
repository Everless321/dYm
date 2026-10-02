'use client'

import { BrandMark } from './icons'

export function AppShell({
  mode,
  crumb,
  status,
  nav,
  onLogout,
  children
}: {
  mode: 'board' | 'client'
  crumb: React.ReactNode
  status: React.ReactNode
  nav: React.ReactNode
  onLogout: () => void
  children: React.ReactNode
}): React.JSX.Element {
  if (mode === 'board') {
    return (
      <div className="shell board">
        <header className="board-bar">
          <a className="brand" href="#/">
            <BrandMark />
            <span className="brand-copy">
              <strong>dYm</strong>
              <small>管理控制台</small>
            </span>
          </a>
          <div className="board-meta">{status}</div>
          <button className="side-logout" type="button" onClick={onLogout}>
            退出登录
          </button>
        </header>
        <div className="board-main">{children}</div>
      </div>
    )
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#/">
          <BrandMark />
          <span className="brand-copy">
            <strong>dYm</strong>
            <small>管理控制台</small>
          </span>
        </a>
        <nav className="side-nav" aria-label="主导航">
          {nav}
        </nav>
        <div className="side-foot">
          <button className="side-logout" type="button" onClick={onLogout}>
            退出登录
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <nav className="crumb" aria-label="当前位置">
            {crumb}
          </nav>
          <div className="top-status">{status}</div>
        </header>
        <main>{children}</main>
      </div>
    </div>
  )
}
