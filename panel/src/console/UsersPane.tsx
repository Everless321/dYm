'use client'

import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { rpc } from './api'
import { useFeedback } from './feedback'
import { errorMessage, formatCount, initials, mediaUrl } from './format'
import type { LiveSync, PanelUser } from './types'
import { EmptyState, Loading, MediaImage, Modal, SyncBadge } from './widgets'

export function UsersPane({
  nodeId,
  sync,
  reload
}: {
  nodeId: string
  sync: Record<number, LiveSync>
  reload: number
}): React.JSX.Element {
  const { toast, ask } = useFeedback()
  const [users, setUsers] = useState<PanelUser[] | null>(null)
  const [error, setError] = useState('')
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<PanelUser | null>(null)
  const [localReload, setLocalReload] = useState(0)

  const closeSettings = useCallback((): void => setEditing(null), [])

  useEffect(() => {
    let cancelled = false
    void rpc<{ users?: PanelUser[] }>(nodeId, 'users.list')
      .then((result) => {
        if (cancelled) return
        setUsers(result.users || [])
        setError('')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [nodeId, reload, localReload])

  async function onAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const next = url.trim()
    if (!next) {
      toast('请粘贴用户主页或作品链接')
      return
    }
    setAdding(true)
    try {
      await rpc(nodeId, 'users.add', { url: next })
      setUrl('')
      toast('已添加')
      setLocalReload((current) => current + 1)
    } catch (err) {
      toast(errorMessage(err))
    } finally {
      setAdding(false)
    }
  }

  async function onSync(id: number): Promise<void> {
    try {
      await rpc(nodeId, 'users.sync', { id })
      toast('已开始同步')
    } catch (err) {
      toast(errorMessage(err))
    }
  }

  async function onRefresh(id: number): Promise<void> {
    try {
      await rpc(nodeId, 'users.refresh', { id })
      toast('资料已刷新')
      setLocalReload((current) => current + 1)
    } catch (err) {
      toast(errorMessage(err))
    }
  }

  async function onDelete(user: PanelUser): Promise<void> {
    const remove = await ask({
      title: '删除用户',
      body: `从这台客户端的列表里删除「${user.nickname || '这个用户'}」？`,
      confirm: '继续',
      danger: true
    })
    if (!remove) return
    const deleteFiles = await ask({
      title: '已下载的文件',
      body: '可以同时删除这台电脑上已经下载的文件。选择保留文件则只从列表移除。',
      confirm: '删除文件',
      cancel: '保留文件',
      danger: true
    })
    try {
      await rpc(nodeId, 'users.delete', { id: user.id, deleteFiles })
      toast(deleteFiles ? '已删除用户和文件' : '已从列表移除')
      setLocalReload((current) => current + 1)
    } catch (err) {
      toast(errorMessage(err))
    }
  }

  return (
    <section className="surface">
      <form className="composer" onSubmit={(event) => void onAdd(event)}>
        <label className="field grow">
          添加用户
          <input
            placeholder="粘贴用户主页或作品链接"
            autoComplete="off"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <button className="primary" type="submit" disabled={adding}>
          {adding ? '正在添加' : '添加'}
        </button>
      </form>
      {users === null && !error ? <Loading text="正在读取用户" /> : null}
      {error ? <EmptyState title="读取失败" body={error} /> : null}
      {users && users.length ? (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">用户</th>
                <th scope="col" className="num">
                  已下载 / 作品
                </th>
                <th scope="col" className="num">
                  粉丝
                </th>
                <th scope="col">同步</th>
                <th scope="col">自动同步</th>
                <th scope="col" className="actions">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const avatar = mediaUrl(nodeId, user.avatar)
                const meta = [user.uniqueId ? `@${user.uniqueId}` : '', user.remark]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <tr key={user.id}>
                    <td>
                      <div className="who">
                        {avatar ? (
                          <MediaImage src={avatar} fallback={initials(user.nickname)} avatar />
                        ) : (
                          <span className="avatar-fallback">{initials(user.nickname)}</span>
                        )}
                        <div>
                          <strong>{user.nickname || '未命名'}</strong>
                          <div className="sub">{meta || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num">
                      {formatCount(user.downloadedCount)} / {formatCount(user.awemeCount)}
                    </td>
                    <td className="num">{formatCount(user.followerCount)}</td>
                    <td>
                      <SyncBadge user={user} live={sync[user.id]} />
                    </td>
                    <td>
                      {user.autoSync ? (
                        <>
                          <strong>开</strong>
                          <div className="sub">{user.syncCron || '未设 Cron'}</div>
                        </>
                      ) : (
                        <span className="muted">关</span>
                      )}
                    </td>
                    <td className="actions">
                      <div className="row-actions">
                        <button className="text" type="button" onClick={() => void onSync(user.id)}>
                          同步
                        </button>
                        <button
                          className="text"
                          type="button"
                          onClick={() => void onRefresh(user.id)}
                        >
                          刷新
                        </button>
                        <button className="text" type="button" onClick={() => setEditing(user)}>
                          设置
                        </button>
                        <button
                          className="text danger-text"
                          type="button"
                          onClick={() => void onDelete(user)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {users && !users.length && !error ? (
        <EmptyState title="还没有用户" body="粘贴用户主页或作品链接，添加到这台客户端。" />
      ) : null}
      {editing ? (
        <UserSettings
          key={editing.id}
          nodeId={nodeId}
          user={editing}
          onClose={closeSettings}
          onSaved={() => {
            setEditing(null)
            setLocalReload((current) => current + 1)
          }}
        />
      ) : null}
    </section>
  )
}

function UserSettings({
  nodeId,
  user,
  onClose,
  onSaved
}: {
  nodeId: string
  user: PanelUser
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const { toast } = useFeedback()
  const [remark, setRemark] = useState(user.remark || '')
  const [maxDownloadCount, setMaxDownloadCount] = useState(String(user.maxDownloadCount || 0))
  const [syncCron, setSyncCron] = useState(user.syncCron || '')
  const [showInHome, setShowInHome] = useState(user.showInHome)
  const [autoSync, setAutoSync] = useState(user.autoSync)
  const [saving, setSaving] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSaving(true)
    try {
      await rpc(nodeId, 'users.updateSettings', {
        id: user.id,
        remark,
        maxDownloadCount: Number(maxDownloadCount),
        syncCron,
        showInHome,
        autoSync
      })
      toast('已保存')
      onSaved()
    } catch (err) {
      toast(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose}>
      <form className="dialog-pad" onSubmit={(event) => void onSubmit(event)}>
        <div className="spread">
          <div>
            <p className="eyebrow">用户设置</p>
            <h2>{user.nickname || '未命名'}</h2>
          </div>
          <button className="ghost" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
        <label className="field">
          备注
          <input
            maxLength={200}
            value={remark}
            onChange={(event) => setRemark(event.target.value)}
          />
        </label>
        <label className="field">
          单用户下载上限
          <input
            type="number"
            min={0}
            value={maxDownloadCount}
            onChange={(event) => setMaxDownloadCount(event.target.value)}
          />
          <span className="muted">0 表示使用这台客户端的全局设置。</span>
        </label>
        <label className="field">
          自动同步 Cron
          <input
            value={syncCron}
            placeholder="留空表示不定时，例如 0 8 * * *"
            onChange={(event) => setSyncCron(event.target.value)}
          />
        </label>
        <div className="stack">
          <label className="checkline">
            <input
              type="checkbox"
              checked={showInHome}
              onChange={(event) => setShowInHome(event.target.checked)}
            />
            在桌面端首页显示
          </label>
          <label className="checkline">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(event) => setAutoSync(event.target.checked)}
            />
            启用自动同步
          </label>
        </div>
        <div className="dialog-actions">
          <button className="primary" type="submit" disabled={saving}>
            保存
          </button>
        </div>
      </form>
    </Modal>
  )
}
