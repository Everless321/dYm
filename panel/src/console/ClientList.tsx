'use client'

import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './api'
import { useFeedback } from './feedback'
import {
  errorMessage,
  formatAgo,
  formatCount,
  formatExact,
  initials,
  platformText,
  tone
} from './format'
import type { PanelKey, PanelNode } from './types'
import { EmptyState, Loading, Metric, Modal, StatusBadge, LoginBadge } from './widgets'

export function ClientList({
  onSummary
}: {
  onSummary: (summary: { online: number; total: number } | null) => void
}): React.JSX.Element {
  const { toast, ask } = useFeedback()
  const [nodes, setNodes] = useState<PanelNode[]>([])
  const [keys, setKeys] = useState<PanelKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [name, setName] = useState('')
  const [issuing, setIssuing] = useState(false)
  const [secret, setSecret] = useState('')

  const closeKey = useCallback((): void => setSecret(''), [])

  useEffect(() => {
    document.title = '客户端 · dYm 管理控制台'
    let cancelled = false
    void Promise.all([
      api<{ nodes: PanelNode[] }>('/api/nodes'),
      api<{ keys: PanelKey[] }>('/api/keys')
    ])
      .then(([nodeData, keyData]) => {
        if (cancelled) return
        setNodes(nodeData.nodes)
        setKeys(keyData.keys)
        setError('')
        const online = nodeData.nodes.filter((node) => node.online).length
        onSummary({ online, total: nodeData.nodes.length })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = errorMessage(err)
        setError(message)
        onSummary(null)
        toast(message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reload, onSummary, toast])

  async function onIssue(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setIssuing(true)
    try {
      const issued = await api<{ key: string }>('/api/keys', {
        method: 'POST',
        body: JSON.stringify({ name })
      })
      setSecret(issued.key)
      setName('')
      setReload((current) => current + 1)
    } catch (err) {
      toast(errorMessage(err))
    } finally {
      setIssuing(false)
    }
  }

  async function onRevoke(id: string): Promise<void> {
    const key = keys.find((item) => item.id === id)
    const ok = await ask({
      title: '吊销密钥',
      body: `吊销「${key?.name || '这把密钥'}」后，使用它的电脑会断开，且不能再用这把密钥连入。`,
      confirm: '吊销',
      danger: true
    })
    if (!ok) return
    try {
      await api(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' })
      toast('已吊销')
      setReload((current) => current + 1)
    } catch (err) {
      toast(errorMessage(err))
    }
  }

  async function copySecret(): Promise<void> {
    try {
      await navigator.clipboard.writeText(secret)
      toast('已复制')
    } catch {
      toast('复制失败，请手动选中密钥')
    }
  }

  const online = nodes.filter((node) => node.online).length
  const users = nodes.reduce((total, node) => total + (node.counts?.users || 0), 0)
  const posts = nodes.reduce((total, node) => total + (node.counts?.posts || 0), 0)

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>客户端</h1>
          <p className="lede">
            先选择一台，再管理这一台的作品、用户和下载任务。各台数据不会混在一起。
          </p>
        </div>
      </header>
      {loading ? <Loading text="正在读取客户端" /> : null}
      {error && !loading ? (
        <section className="surface">
          <EmptyState title="没有完成这次读取" body={error} />
        </section>
      ) : null}
      {!loading && !error ? (
        <>
          <section className="metrics" aria-label="概览">
            <Metric label="在线" value={formatCount(online)} hint="当前保持连接" />
            <Metric label="离线" value={formatCount(nodes.length - online)} hint="等待重新连入" />
            <Metric label="用户" value={formatCount(users)} hint="各客户端上次上报" />
            <Metric label="作品" value={formatCount(posts)} hint="各客户端上次上报" />
          </section>
          <section className="surface">
            <div className="surface-head">
              <div>
                <h2>全部客户端</h2>
                <p>点进一台之后，后续操作只作用于这一台。</p>
              </div>
              <span className="count-chip">{formatCount(nodes.length)} 台</span>
            </div>
            {nodes.length ? (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th scope="col">客户端</th>
                      <th scope="col">状态</th>
                      <th scope="col">主机</th>
                      <th scope="col">版本</th>
                      <th scope="col">抖音</th>
                      <th scope="col" className="num">
                        用户
                      </th>
                      <th scope="col" className="num">
                        作品
                      </th>
                      <th scope="col">最近心跳</th>
                      <th scope="col" className="actions">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {nodes.map((node) => {
                      const host = [node.hostname || '未知主机', platformText(node.platform)]
                        .filter(Boolean)
                        .join(' · ')
                      return (
                        <tr key={node.id}>
                          <td>
                            <a className="entity" href={`#/n/${encodeURIComponent(node.id)}/posts`}>
                              <span className={`mono t${tone(node.name)}`}>
                                {initials(node.name)}
                              </span>
                              <span>
                                <strong>{node.name}</strong>
                                <span className="sub">
                                  {node.keyPrefix ? `密钥 ${node.keyPrefix}…` : '未关联密钥'}
                                </span>
                              </span>
                            </a>
                          </td>
                          <td>
                            <StatusBadge online={node.online} />
                          </td>
                          <td className="clip" title={host}>
                            {host}
                          </td>
                          <td>
                            {node.version ? (
                              <span className="code">{node.version}</span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>
                            <LoginBadge login={node.login} />
                          </td>
                          <td className="num">{formatCount(node.counts?.users)}</td>
                          <td className="num">{formatCount(node.counts?.posts)}</td>
                          <td title={formatExact(node.lastSeen)}>{formatAgo(node.lastSeen)}</td>
                          <td className="actions">
                            <a className="btn" href={`#/n/${encodeURIComponent(node.id)}/posts`}>
                              进入
                            </a>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="还没有客户端"
                body="在下方签发密钥，填进对应电脑的 dYm。客户端会自己连到这里。"
              />
            )}
          </section>
          <section className="surface">
            <div className="surface-head">
              <div>
                <h2>节点密钥</h2>
                <p>一把密钥对应一台电脑。完整内容只在签发时显示一次。</p>
              </div>
              <span className="count-chip">{formatCount(keys.length)} 把</span>
            </div>
            <form className="composer" onSubmit={(event) => void onIssue(event)}>
              <label className="field grow">
                名称
                <input
                  maxLength={64}
                  placeholder="例如：客厅电脑"
                  autoComplete="off"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <button className="primary" type="submit" disabled={issuing}>
                签发密钥
              </button>
            </form>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">名称</th>
                    <th scope="col">前缀</th>
                    <th scope="col">客户端</th>
                    <th scope="col">签发</th>
                    <th scope="col">状态</th>
                    <th scope="col" className="actions">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {keys.length ? (
                    keys.map((key) => {
                      const linked = nodes.find((node) => node.id === key.nodeId)
                      return (
                        <tr key={key.id}>
                          <td>
                            <strong>{key.name}</strong>
                          </td>
                          <td>
                            <span className="code">{key.prefix}…</span>
                          </td>
                          <td>{linked?.name || '—'}</td>
                          <td title={formatExact(key.createdAt)}>{formatAgo(key.createdAt)}</td>
                          <td>
                            <StatusBadge online={key.online} />
                          </td>
                          <td className="actions">
                            <button
                              className="text danger-text"
                              type="button"
                              onClick={() => void onRevoke(key.id)}
                            >
                              吊销
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState title="还没有密钥" body="签发后把完整密钥填进那台 dYm。" />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
      <Modal open={secret !== ''} onClose={closeKey}>
        <div className="dialog-pad">
          <div>
            <p className="eyebrow">节点密钥</p>
            <h2>密钥已签发</h2>
          </div>
          <p className="warn-text">
            关闭这个窗口后不能再查看完整密钥。请立刻复制到对应电脑的 dYm 设置里。
          </p>
          <pre className="key-box">{secret}</pre>
          <div className="dialog-actions">
            <button className="ghost" type="button" onClick={closeKey}>
              关闭
            </button>
            <button className="primary" type="button" onClick={() => void copySecret()}>
              复制密钥
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
