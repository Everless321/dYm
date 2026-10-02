'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, UNAUTHORIZED_EVENT } from './api'
import { formatCount, readRoute } from './format'
import { IconNodes, IconPosts, IconTasks, IconUsers } from './icons'
import type { PanelNode, Route } from './types'
import { ClientList } from './ClientList'
import { FeedbackProvider } from './FeedbackProvider'
import { LoginScreen } from './LoginScreen'
import { NodeView } from './NodeView'
import { AppShell } from './shell'
import { NavItem } from './widgets'

export function Console(): React.JSX.Element {
  return (
    <FeedbackProvider>
      <ConsoleGate />
    </FeedbackProvider>
  )
}

function ConsoleGate(): React.JSX.Element {
  const [phase, setPhase] = useState<'boot' | 'login' | 'app'>('boot')

  useEffect(() => {
    let cancelled = false
    void api('/api/me')
      .then(() => {
        if (!cancelled) setPhase('app')
      })
      .catch(() => {
        if (!cancelled) setPhase('login')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onDenied = (): void => setPhase('login')
    window.addEventListener(UNAUTHORIZED_EVENT, onDenied)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onDenied)
  }, [])

  function enter(): void {
    if (window.location.hash !== '#/' && window.location.hash !== '') {
      window.location.hash = '#/'
    }
    setPhase('app')
  }

  if (phase === 'boot') {
    return (
      <div className="loading boot">
        <span className="bar" aria-hidden="true" />
        正在确认登录状态
      </div>
    )
  }
  if (phase === 'login') return <LoginScreen onSuccess={enter} />
  return <AuthedShell onLogout={() => setPhase('login')} />
}

function AuthedShell({ onLogout }: { onLogout: () => void }): React.JSX.Element {
  const [route, setRoute] = useState<Route>(() => readRoute(window.location.hash))
  const [activeNode, setActiveNode] = useState<PanelNode | null | undefined>(undefined)
  const [summary, setSummary] = useState<{ online: number; total: number } | null>(null)

  const onNode = useCallback((node: PanelNode | null): void => {
    setActiveNode(node)
  }, [])
  const onSummary = useCallback((next: { online: number; total: number } | null): void => {
    setSummary(next)
  }, [])

  useEffect(() => {
    const onHash = (): void => {
      const next = readRoute(window.location.hash)
      setRoute(next)
      setActiveNode((current) => {
        if (next.name === 'list') return null
        if (current && current.id === next.id) return current
        return undefined
      })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  async function logout(): Promise<void> {
    await api('/api/logout', { method: 'POST' }).catch(() => undefined)
    onLogout()
  }

  const crumb =
    route.name === 'list' ? (
      <strong>客户端</strong>
    ) : (
      <>
        <a href="#/">客户端</a>
        <span className="sep">/</span>
        <strong>{activeNode ? activeNode.name : activeNode === null ? '未找到' : '…'}</strong>
      </>
    )
  const status =
    route.name === 'list'
      ? summary
        ? `${formatCount(summary.online)} 在线 · ${formatCount(summary.total)} 台`
        : ''
      : activeNode?.keyPrefix
        ? `密钥 ${activeNode.keyPrefix}…`
        : ''

  return (
    <AppShell
      crumb={crumb}
      status={status}
      onLogout={() => void logout()}
      nav={
        <>
          <p className="nav-label">总览</p>
          <NavItem href="#/" icon={<IconNodes />} label="客户端" active={route.name === 'list'} />
          {route.name === 'node' && activeNode ? (
            <>
              <p className="nav-label">当前客户端</p>
              <div className="nav-current">
                <strong>{activeNode.name}</strong>
                <span>{activeNode.online ? '在线' : '离线'}</span>
              </div>
              <NavItem
                href={`#/n/${encodeURIComponent(activeNode.id)}/posts`}
                icon={<IconPosts />}
                label="作品"
                active={route.tab === 'posts'}
              />
              <NavItem
                href={`#/n/${encodeURIComponent(activeNode.id)}/users`}
                icon={<IconUsers />}
                label="用户"
                active={route.tab === 'users'}
              />
              <NavItem
                href={`#/n/${encodeURIComponent(activeNode.id)}/tasks`}
                icon={<IconTasks />}
                label="下载任务"
                active={route.tab === 'tasks'}
              />
            </>
          ) : null}
        </>
      }
    >
      {route.name === 'list' ? (
        <ClientList onSummary={onSummary} />
      ) : (
        <NodeView key={route.id} id={route.id} tab={route.tab} onNode={onNode} />
      )}
    </AppShell>
  )
}
