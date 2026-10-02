'use client'

import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { errorMessage, formatCount, platformText } from './format'
import type { LiveDownload, LiveSync, NodeTab, PanelNode, PostQuery } from './types'
import { EMPTY_POST_QUERY } from './types'
import { PostsPane } from './PostsPane'
import { TasksPane } from './TasksPane'
import { UsersPane } from './UsersPane'
import { EmptyState, Loading, LoginBadge, Metric, StatusBadge } from './widgets'

export function NodeView({
  id,
  tab,
  onNode
}: {
  id: string
  tab: NodeTab
  onNode: (node: PanelNode | null) => void
}): React.JSX.Element {
  const [node, setNode] = useState<PanelNode | null>(null)
  const [missing, setMissing] = useState('')
  const [activated, setActivated] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [query, setQuery] = useState<PostQuery>(EMPTY_POST_QUERY)
  const [sync, setSync] = useState<Record<number, LiveSync>>({})
  const [downloads, setDownloads] = useState<Record<number, LiveDownload>>({})
  const nodeRef = useRef<PanelNode | null>(null)
  const activatedRef = useRef(false)

  function publish(next: PanelNode): void {
    nodeRef.current = next
    setNode(next)
    onNode(next)
    document.title = `${next.name} · dYm 管理控制台`
  }

  useEffect(() => {
    let cancelled = false
    void api<{ node: PanelNode }>(`/api/nodes/${encodeURIComponent(id)}`)
      .then((data) => {
        if (cancelled) return
        publish(data.node)
        activatedRef.current = data.node.online
        setActivated(data.node.online)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setMissing(errorMessage(err))
        onNode(null)
      })
    return () => {
      cancelled = true
    }
    // publish 读取的是当次响应，不需要放进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, onNode])

  useEffect(() => {
    const source = new EventSource(`/api/nodes/${encodeURIComponent(id)}/events`)
    const onSync = (event: Event): void => {
      const data = JSON.parse((event as MessageEvent<string>).data) as LiveSync
      if (typeof data.userId !== 'number') return
      setSync((current) => ({ ...current, [data.userId]: data }))
    }
    const onDownload = (event: Event): void => {
      const data = JSON.parse((event as MessageEvent<string>).data) as LiveDownload
      if (typeof data.taskId !== 'number') return
      setDownloads((current) => ({ ...current, [data.taskId]: data }))
    }
    const onSnapshot = (): void => {
      const current = nodeRef.current
      if (!current) return
      const wasOnline = current.online
      publish({ ...current, online: true })
      if (activatedRef.current && !wasOnline) setRefreshKey((key) => key + 1)
      activatedRef.current = true
      setActivated(true)
    }
    source.addEventListener('sync', onSync)
    source.addEventListener('download', onDownload)
    source.addEventListener('snapshot', onSnapshot)
    const timer = window.setInterval(() => {
      void api<{ node: PanelNode }>(`/api/nodes/${encodeURIComponent(id)}`)
        .then((data) => {
          const wasOnline = nodeRef.current?.online ?? false
          publish(data.node)
          if (data.node.online) {
            if (activatedRef.current && !wasOnline) setRefreshKey((key) => key + 1)
            activatedRef.current = true
            setActivated(true)
          }
        })
        .catch(() => undefined)
    }, 8000)
    return () => {
      source.close()
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, onNode])

  if (missing) {
    return (
      <div className="page">
        <section className="surface">
          <EmptyState
            title="找不到这台客户端"
            body={missing}
            action={
              <a className="btn" href="#/">
                返回列表
              </a>
            }
          />
        </section>
      </div>
    )
  }

  if (!node) return <Loading text="正在读取" />

  const counts = node.counts || { users: 0, posts: 0, runningTasks: 0, syncingUsers: 0 }
  const meta = [node.hostname, platformText(node.platform), node.version]
    .filter(Boolean)
    .join(' · ')
  const tabs: Array<[NodeTab, string]> = [
    ['posts', '作品'],
    ['users', '用户'],
    ['tasks', '下载任务']
  ]

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{node.name}</h1>
          <p className="lede">{meta || '还没有上报主机信息'}</p>
        </div>
        <div className="head-side">
          <StatusBadge online={node.online} />
          <LoginBadge login={node.login} />
        </div>
      </header>
      <p className="note">
        抖音登录需要在这台电脑的 dYm 窗口里完成。这里只显示状态，不会读取 Cookie。
      </p>
      <section className="metrics" aria-label="这台客户端">
        <Metric label="用户" value={formatCount(counts.users)} hint="上次上报" />
        <Metric label="作品" value={formatCount(counts.posts)} hint="上次上报" />
        <Metric label="下载任务" value={formatCount(counts.runningTasks)} hint="进行中" />
        <Metric label="同步" value={formatCount(counts.syncingUsers)} hint="正在同步的用户" />
      </section>
      <nav className="tabs">
        {tabs.map(([key, label]) => (
          <a
            key={key}
            className={tab === key ? 'active' : undefined}
            href={`#/n/${encodeURIComponent(id)}/${key}`}
          >
            {label}
          </a>
        ))}
      </nav>
      {activated && !node.online ? (
        <p className="note warn">这台客户端刚刚离线。已打开的内容暂时不能继续操作。</p>
      ) : null}
      {node.online || activated ? (
        tab === 'users' ? (
          <UsersPane nodeId={id} sync={sync} reload={refreshKey} />
        ) : tab === 'tasks' ? (
          <TasksPane nodeId={id} downloads={downloads} reload={refreshKey} />
        ) : (
          <PostsPane nodeId={id} query={query} setQuery={setQuery} reload={refreshKey} />
        )
      ) : (
        <section className="surface">
          <EmptyState
            title="客户端离线"
            body={`暂时不能浏览或下发操作。上次上报：用户 ${formatCount(counts.users)}，作品 ${formatCount(counts.posts)}。`}
          />
        </section>
      )}
    </div>
  )
}
