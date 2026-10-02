'use client'

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { rpc } from './api'
import { useFeedback } from './feedback'
import { errorMessage, formatCount, taskProgress } from './format'
import type { LiveDownload, PanelTask, PanelUser } from './types'
import { EmptyState, Loading, TaskBadge } from './widgets'

export function TasksPane({
  nodeId,
  downloads,
  reload
}: {
  nodeId: string
  downloads: Record<number, LiveDownload>
  reload: number
}): React.JSX.Element {
  const { toast, ask } = useFeedback()
  const [tasks, setTasks] = useState<PanelTask[] | null>(null)
  const [users, setUsers] = useState<PanelUser[]>([])
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [creating, setCreating] = useState(false)
  const [localReload, setLocalReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      rpc<{ tasks?: PanelTask[] }>(nodeId, 'tasks.list'),
      rpc<{ users?: PanelUser[] }>(nodeId, 'users.list')
    ])
      .then(([taskData, userData]) => {
        if (cancelled) return
        setTasks(taskData.tasks || [])
        setUsers(userData.users || [])
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

  function toggleUser(id: number, checked: boolean): void {
    setPicked((current) => {
      if (checked) return current.includes(id) ? current : [...current, id]
      return current.filter((item) => item !== id)
    })
  }

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const form = event.currentTarget
    const taskName = String(new FormData(form).get('name') || '').trim()
    if (!picked.length) {
      toast('请选择至少一个用户')
      return
    }
    setCreating(true)
    try {
      await rpc(nodeId, 'tasks.create', { name: taskName, userIds: picked })
      form.reset()
      setPicked([])
      toast('已创建')
      setLocalReload((current) => current + 1)
    } catch (err) {
      toast(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  async function onStart(id: number): Promise<void> {
    try {
      await rpc(nodeId, 'tasks.start', { id })
      setTasks(
        (current) =>
          current?.map((task) =>
            task.id === id ? { ...task, running: true, status: 'running' } : task
          ) || current
      )
      toast('已开始')
    } catch (err) {
      toast(errorMessage(err))
    }
  }

  async function onStop(id: number): Promise<void> {
    try {
      await rpc(nodeId, 'tasks.stop', { id })
      toast('已请求停止')
    } catch (err) {
      toast(errorMessage(err))
    }
  }

  async function onRemove(task: PanelTask): Promise<void> {
    const ok = await ask({
      title: '删除下载任务',
      body: `删除「${task.name || '这个任务'}」？已经下载的文件会保留。`,
      confirm: '删除',
      danger: true
    })
    if (!ok) return
    try {
      await rpc(nodeId, 'tasks.delete', { id: task.id })
      toast('已删除')
      setLocalReload((current) => current + 1)
    } catch (err) {
      toast(errorMessage(err))
    }
  }

  return (
    <div className="stack">
      <form className="surface composer-block" onSubmit={(event) => void onCreate(event)}>
        <div className="surface-head" style={{ padding: 0, border: 0 }}>
          <div>
            <h2>新建下载任务</h2>
            <p>任务只在这台客户端上创建和执行。</p>
          </div>
        </div>
        <label className="field">
          任务名称
          <input name="name" maxLength={80} required placeholder="例如：本周更新" />
        </label>
        <div className="field">
          <span className="field-label">
            <span>选择用户</span>
            <span className="muted">已选 {picked.length} 人</span>
          </span>
          <div className="pick-list">
            {users.length ? (
              users.map((user) => (
                <label key={user.id}>
                  <input
                    type="checkbox"
                    checked={picked.includes(user.id)}
                    onChange={(event) => toggleUser(user.id, event.target.checked)}
                  />
                  {user.nickname || '未命名'}
                </label>
              ))
            ) : (
              <div className="empty">先到用户页添加用户</div>
            )}
          </div>
        </div>
        <div className="dialog-actions">
          <button className="primary" type="submit" disabled={creating}>
            创建任务
          </button>
        </div>
      </form>
      <section className="surface">
        <div className="surface-head">
          <h2>任务列表</h2>
          <span className="count-chip">{formatCount(tasks?.length || 0)} 个</span>
        </div>
        {tasks === null && !error ? <Loading text="正在读取任务" /> : null}
        {error ? <EmptyState title="读取失败" body={error} /> : null}
        {tasks && tasks.length ? (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">任务</th>
                  <th scope="col">状态</th>
                  <th scope="col">进度</th>
                  <th scope="col" className="actions">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const names = (task.users || []).map((user) => user.nickname).join('、')
                  return (
                    <tr key={task.id}>
                      <td>
                        <strong>{task.name}</strong>
                        <div className="sub">{names || '未指定用户'}</div>
                      </td>
                      <td>
                        <TaskBadge task={task} />
                      </td>
                      <td>{taskProgress(task, downloads[task.id])}</td>
                      <td className="actions">
                        <div className="row-actions">
                          <button
                            className="text"
                            type="button"
                            onClick={() => void onStart(task.id)}
                          >
                            开始
                          </button>
                          <button
                            className="text"
                            type="button"
                            onClick={() => void onStop(task.id)}
                          >
                            停止
                          </button>
                          <button
                            className="text danger-text"
                            type="button"
                            onClick={() => void onRemove(task)}
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
        {tasks && !tasks.length && !error ? (
          <EmptyState title="还没有下载任务" body="选好用户并填写名称后即可创建。" />
        ) : null}
      </section>
    </div>
  )
}
