'use client'

import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { rpc } from './api'
import { useFeedback } from './feedback'
import {
  errorMessage,
  formatCount,
  formatUnixAgo,
  formatUnixExact,
  initials,
  mediaUrl
} from './format'
import type { LiveSync, PanelUser } from './types'
import { CronPresets, EmptyState, Loading, MediaImage, Modal, SyncBadge } from './widgets'
import {
  CREATOR_PLATFORM_LABEL,
  defaultBilibiliCreatorSettings,
  detectCreatorPlatform,
  type BilibiliCreatorSettings
} from '../../../src/shared/platforms'

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
  const [maxDownloadCount, setMaxDownloadCount] = useState('0')
  const [showInHome, setShowInHome] = useState(true)
  const [autoSync, setAutoSync] = useState(false)
  const [syncCron, setSyncCron] = useState('')
  const [liveRecord, setLiveRecord] = useState(false)
  const [liveCheckCron, setLiveCheckCron] = useState('')
  const [bilibili, setBilibili] = useState<BilibiliCreatorSettings>(defaultBilibiliCreatorSettings)
  const [editing, setEditing] = useState<PanelUser | null>(null)
  const [keyword, setKeyword] = useState('')
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
    const platform = detectCreatorPlatform(next)
    if (!platform) {
      toast('请粘贴抖音或哔哩哔哩的创作者主页或作品链接')
      return
    }
    setAdding(true)
    try {
      await rpc(nodeId, 'users.add', {
        url: next,
        maxDownloadCount: Number(maxDownloadCount) || 0,
        showInHome,
        autoSync,
        syncCron,
        liveRecord: platform === 'douyin' ? liveRecord : false,
        liveCheckCron: platform === 'douyin' ? liveCheckCron : '',
        bilibili: platform === 'bilibili' ? bilibili : undefined
      })
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

  async function onStop(id: number): Promise<void> {
    try {
      await rpc(nodeId, 'users.stopSync', { id })
      toast('已请求停止')
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

  const query = keyword.trim().toLowerCase()
  const shown = (users || []).filter((user) => {
    if (!query) return true
    return [user.nickname, user.uniqueId, user.remark, user.signature]
      .filter(Boolean)
      .some((part) => String(part).toLowerCase().includes(query))
  })

  return (
    <section className="surface">
      <form className="composer" onSubmit={(event) => void onAdd(event)}>
        <label className="field grow">
          添加创作者
          <input
            placeholder="粘贴抖音或哔哩哔哩的主页、作品链接"
            autoComplete="off"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <button className="primary" type="submit" disabled={adding}>
          {adding ? '正在添加' : '添加'}
        </button>
      </form>
      {detectCreatorPlatform(url) ? (
        <AddCreatorOptions
          platform={detectCreatorPlatform(url) || 'douyin'}
          maxDownloadCount={maxDownloadCount}
          showInHome={showInHome}
          autoSync={autoSync}
          syncCron={syncCron}
          liveRecord={liveRecord}
          liveCheckCron={liveCheckCron}
          bilibili={bilibili}
          onMaxDownloadCount={setMaxDownloadCount}
          onShowInHome={setShowInHome}
          onAutoSync={setAutoSync}
          onSyncCron={setSyncCron}
          onLiveRecord={setLiveRecord}
          onLiveCheckCron={setLiveCheckCron}
          onBilibili={setBilibili}
        />
      ) : null}
      {users && users.length ? (
        <div className="composer">
          <label className="field grow">
            搜索
            <input
              value={keyword}
              placeholder="昵称、账号或备注"
              autoComplete="off"
              onChange={(event) => setKeyword(event.target.value)}
            />
          </label>
        </div>
      ) : null}
      {users === null && !error ? <Loading text="正在读取用户" /> : null}
      {error ? <EmptyState title="读取失败" body={error} /> : null}
      {users && users.length && shown.length ? (
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
              {shown.map((user) => {
                const avatar = mediaUrl(nodeId, user.avatar)
                const home =
                  user.homepageUrl && /^https:\/\//.test(user.homepageUrl) ? user.homepageUrl : ''
                const meta = [
                  user.platform === 'bilibili' ? '哔哩哔哩' : '抖音',
                  user.uniqueId ? `@${user.uniqueId}` : '',
                  user.remark,
                  user.lastSyncAt ? `上次同步 ${formatUnixAgo(user.lastSyncAt)}` : ''
                ]
                  .filter(Boolean)
                  .join(' · ')
                const syncing =
                  user.syncing || user.syncStatus === 'syncing' || Boolean(sync[user.id])
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
                          <div className="sub" title={formatUnixExact(user.lastSyncAt)}>
                            {meta || '—'}
                          </div>
                          {home ? (
                            <a className="sub" href={home} target="_blank" rel="noreferrer">
                              打开主页
                            </a>
                          ) : null}
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
                        {syncing ? (
                          <button
                            className="text"
                            type="button"
                            onClick={() => void onStop(user.id)}
                          >
                            停止
                          </button>
                        ) : (
                          <button
                            className="text"
                            type="button"
                            onClick={() => void onSync(user.id)}
                          >
                            同步
                          </button>
                        )}
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
      {users && users.length && !shown.length && !error ? (
        <EmptyState title="没有匹配的用户" body="换一个昵称、抖音号或备注再搜。" />
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

function AddCreatorOptions({
  platform,
  maxDownloadCount,
  showInHome,
  autoSync,
  syncCron,
  liveRecord,
  liveCheckCron,
  bilibili,
  onMaxDownloadCount,
  onShowInHome,
  onAutoSync,
  onSyncCron,
  onLiveRecord,
  onLiveCheckCron,
  onBilibili
}: {
  platform: 'douyin' | 'bilibili'
  maxDownloadCount: string
  showInHome: boolean
  autoSync: boolean
  syncCron: string
  liveRecord: boolean
  liveCheckCron: string
  bilibili: BilibiliCreatorSettings
  onMaxDownloadCount: (value: string) => void
  onShowInHome: (value: boolean) => void
  onAutoSync: (value: boolean) => void
  onSyncCron: (value: string) => void
  onLiveRecord: (value: boolean) => void
  onLiveCheckCron: (value: string) => void
  onBilibili: (value: BilibiliCreatorSettings) => void
}): React.JSX.Element {
  return (
    <div className="composer">
      <p className="eyebrow">已识别为{CREATOR_PLATFORM_LABEL[platform]}，下面是这个平台的设置</p>
      <label className="field">
        单次下载上限
        <input
          type="number"
          min={0}
          value={maxDownloadCount}
          onChange={(event) => onMaxDownloadCount(event.target.value)}
        />
      </label>
      <label className="field">
        自动同步 Cron
        <input
          value={syncCron}
          placeholder="留空表示不定时，例如 0 8 * * *"
          onChange={(event) => onSyncCron(event.target.value)}
        />
        <CronPresets value={syncCron} onPick={onSyncCron} />
      </label>
      <label className="checkline">
        <input
          type="checkbox"
          checked={showInHome}
          onChange={(event) => onShowInHome(event.target.checked)}
        />
        在桌面端首页显示
      </label>
      <label className="checkline">
        <input
          type="checkbox"
          checked={autoSync}
          onChange={(event) => onAutoSync(event.target.checked)}
        />
        启用自动同步
      </label>
      {platform === 'douyin' ? (
        <>
          <label className="checkline">
            <input
              type="checkbox"
              checked={liveRecord}
              onChange={(event) => onLiveRecord(event.target.checked)}
            />
            录制抖音直播
          </label>
          {liveRecord ? (
            <label className="field">
              直播检测 Cron
              <input
                value={liveCheckCron}
                placeholder="*/5 * * * *"
                onChange={(event) => onLiveCheckCron(event.target.value)}
              />
            </label>
          ) : null}
        </>
      ) : (
        <BilibiliOptionFields value={bilibili} onChange={onBilibili} />
      )}
    </div>
  )
}

function BilibiliOptionFields({
  value,
  onChange
}: {
  value: BilibiliCreatorSettings
  onChange: (value: BilibiliCreatorSettings) => void
}): React.JSX.Element {
  return (
    <>
      <label className="field">
        画质
        <select
          value={value.videoQuality}
          onChange={(event) => onChange({ ...value, videoQuality: Number(event.target.value) })}
        >
          <option value={80}>1080P</option>
          <option value={64}>720P</option>
          <option value={116}>1080P 60帧</option>
          <option value={120}>4K</option>
          <option value={127}>8K</option>
        </select>
      </label>
      <label className="field">
        视频编码
        <select
          value={value.videoCodec}
          onChange={(event) =>
            onChange({
              ...value,
              videoCodec: event.target.value as BilibiliCreatorSettings['videoCodec']
            })
          }
        >
          <option value="avc">H.264 / AVC</option>
          <option value="hevc">H.265 / HEVC</option>
          <option value="av1">AV1</option>
        </select>
      </label>
      <label className="field">
        音质
        <select
          value={value.audioQuality}
          onChange={(event) => onChange({ ...value, audioQuality: Number(event.target.value) })}
        >
          <option value={30232}>132K</option>
          <option value={30280}>192K</option>
          <option value={30250}>Hi-Res</option>
          <option value={30251}>杜比全景声</option>
        </select>
      </label>
      {(
        [
          ['downloadVideo', '下载视频'],
          ['downloadAudio', '下载音频'],
          ['downloadCover', '下载封面'],
          ['downloadDanmaku', '下载弹幕'],
          ['downloadSubtitle', '下载字幕'],
          ['downloadAllPages', '下载全部分 P']
        ] as const
      ).map(([key, label]) => (
        <label className="checkline" key={key}>
          <input
            type="checkbox"
            checked={value[key]}
            onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
          />
          {label}
        </label>
      ))}
    </>
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
  const [liveRecord, setLiveRecord] = useState(Boolean(user.liveRecord))
  const [liveCheckCron, setLiveCheckCron] = useState(user.liveCheckCron || '')
  const [bilibili, setBilibili] = useState<BilibiliCreatorSettings>(
    user.bilibili || defaultBilibiliCreatorSettings()
  )
  const [saving, setSaving] = useState(false)
  const platform = user.platform === 'bilibili' ? 'bilibili' : 'douyin'

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
        autoSync,
        liveRecord: platform === 'douyin' ? liveRecord : false,
        liveCheckCron: platform === 'douyin' ? liveCheckCron : '',
        bilibili: platform === 'bilibili' ? bilibili : undefined
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
            <p className="eyebrow">{CREATOR_PLATFORM_LABEL[platform]}创作者</p>
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
          <CronPresets value={syncCron} onPick={setSyncCron} />
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
          {platform === 'douyin' ? (
            <label className="checkline">
              <input
                type="checkbox"
                checked={liveRecord}
                onChange={(event) => setLiveRecord(event.target.checked)}
              />
              录制抖音直播
            </label>
          ) : null}
        </div>
        {platform === 'douyin' && liveRecord ? (
          <label className="field">
            直播检测 Cron
            <input
              value={liveCheckCron}
              placeholder="*/5 * * * *"
              onChange={(event) => setLiveCheckCron(event.target.value)}
            />
          </label>
        ) : null}
        {platform === 'bilibili' ? (
          <BilibiliOptionFields value={bilibili} onChange={setBilibili} />
        ) : null}
        <div className="dialog-actions">
          <button className="primary" type="submit" disabled={saving}>
            保存
          </button>
        </div>
      </form>
    </Modal>
  )
}
