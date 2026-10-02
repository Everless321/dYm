'use client'

import { BrandMark } from './icons'

export function AppShell({
  crumb,
  status,
  nav,
  onLogout,
  children
}: {
  crumb: React.ReactNode
  status: React.ReactNode
  nav: React.ReactNode
  onLogout: () => void
  children: React.ReactNode
}): React.JSX.Element {
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
