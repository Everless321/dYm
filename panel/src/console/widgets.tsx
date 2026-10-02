'use client'

import { useEffect, useState } from 'react'
import type { LiveSync, PanelLogin, PanelTask, PanelUser } from './types'

export function Loading({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="loading">
      <span className="bar" aria-hidden="true" />
      {text}
    </div>
  )
}

export function EmptyState({
  title,
  body,
  action
}: {
  title: string
  body: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  )
}

export function Metric({
  label,
  value,
  hint
}: {
  label: string
  value: string
  hint: string
}): React.JSX.Element {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{hint}</em>
    </article>
  )
}

export function NavItem({
  href,
  icon,
  label,
  active
}: {
  href: string
  icon: React.ReactNode
  label: string
  active: boolean
}): React.JSX.Element {
  return (
    <a className={active ? 'nav-item active' : 'nav-item'} href={href}>
      {icon}
      <span>{label}</span>
    </a>
  )
}

export function StatusBadge({ online }: { online: boolean }): React.JSX.Element {
  return (
    <span className={online ? 'badge ok' : 'badge off'}>
      <i />
      <span>{online ? '在线' : '离线'}</span>
    </span>
  )
}

export function LoginBadge({ login }: { login: PanelLogin | undefined }): React.JSX.Element {
  if (!login?.loggedIn) {
    return (
      <span className="badge warn">
        <i />
        <span>未登录抖音</span>
      </span>
    )
  }
  const who = login.uniqueId ? `抖音号 ${login.uniqueId}` : login.nickname || '已登录抖音'
  return (
    <span className="badge ok">
      <i />
      <span>{who}</span>
    </span>
  )
}

export function SyncBadge({
  user,
  live
}: {
  user: Pick<PanelUser, 'syncing' | 'syncStatus'>
  live?: LiveSync
}): React.JSX.Element {
  if (live?.message) {
    return (
      <span className="badge info">
        <i />
        <span>{live.message}</span>
      </span>
    )
  }
  if (user.syncing || user.syncStatus === 'syncing') {
    return (
      <span className="badge info">
        <i />
        <span>同步中</span>
      </span>
    )
  }
  if (user.syncStatus === 'error') {
    return (
      <span className="badge err">
        <i />
        <span>失败</span>
      </span>
    )
  }
  return (
    <span className="badge off">
      <i />
      <span>空闲</span>
    </span>
  )
}

export function TaskBadge({
  task
}: {
  task: Pick<PanelTask, 'running' | 'status'>
}): React.JSX.Element {
  if (task.running || task.status === 'running') {
    return (
      <span className="badge info">
        <i />
        <span>进行中</span>
      </span>
    )
  }
  if (task.status === 'failed') {
    return (
      <span className="badge err">
        <i />
        <span>失败</span>
      </span>
    )
  }
  if (task.status === 'completed') {
    return (
      <span className="badge ok">
        <i />
        <span>已完成</span>
      </span>
    )
  }
  return (
    <span className="badge off">
      <i />
      <span>待命</span>
    </span>
  )
}

export function MediaImage({
  src,
  fallback,
  avatar
}: {
  src: string
  fallback: string
  avatar?: boolean
}): React.JSX.Element {
  const [failedSrc, setFailedSrc] = useState('')
  if (failedSrc === src) {
    return <span className={avatar ? 'avatar-fallback' : 'cover-fallback'}>{fallback}</span>
  }
  return (
    <img
      className={avatar ? 'avatar' : undefined}
      alt=""
      src={src}
      onError={() => setFailedSrc(src)}
    />
  )
}

export function Modal({
  open,
  wide,
  onClose,
  children
}: {
  open: boolean
  wide?: boolean
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <div
      className="modal"
      hidden={!open}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {open ? (
        <div className={wide ? 'dialog wide' : 'dialog'} role="dialog" aria-modal="true">
          {children}
        </div>
      ) : null}
    </div>
  )
}
