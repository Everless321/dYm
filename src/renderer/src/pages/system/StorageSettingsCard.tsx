import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CloudUpload, Loader2, PlugZap, RotateCcw } from 'lucide-react'
import type {
  StorageConfigInput,
  StorageConfigView,
  StorageQueueStats
} from '../../../../shared/storage'
import { StorageMigrationPanel } from './StorageMigrationPanel'

const inputClass =
  'w-full md:w-[320px] h-10 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] transition-colors focus:outline-none focus-visible:border-[#0A84FF] focus-visible:ring-2 focus-visible:ring-[#0A84FF]/20'
const secondaryButton =
  'h-9 px-4 rounded-lg border border-[#E5E5E7] text-sm text-[#1D1D1F] hover:bg-[#F2F2F4] transition-colors flex items-center gap-2 disabled:opacity-50'
const STATS_POLL_MS = 3000

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm text-[#1D1D1F]">{label}</p>
        {hint && <p className="text-xs text-[#A1A1A6] mt-1">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function toInput(view: StorageConfigView): StorageConfigInput {
  return {
    enabled: view.enabled,
    endpoint: view.endpoint,
    region: view.region,
    bucket: view.bucket,
    accessKeyId: view.accessKeyId,
    secretAccessKey: '',
    publicBaseUrl: view.publicBaseUrl,
    relayUrl: view.relayUrl,
    relayToken: '',
    concurrency: view.concurrency,
    localPolicy: view.localPolicy,
    graceDays: view.graceDays,
    cacheGb: view.cacheGb
  }
}

export function StorageSettingsCard(): React.JSX.Element {
  const [view, setView] = useState<StorageConfigView | null>(null)
  const [form, setForm] = useState<StorageConfigInput | null>(null)
  const [stats, setStats] = useState<StorageQueueStats | null>(null)
  const [busy, setBusy] = useState<'save' | 'test' | 'enqueue' | 'retry' | null>(null)

  const refreshStats = useCallback(async () => {
    try {
      setStats(await window.api.storage.getStats())
    } catch (error) {
      console.warn('读取上传状态失败:', error)
    }
  }, [])

  useEffect(() => {
    window.api.storage
      .getConfig()
      .then((v) => {
        setView(v)
        setForm(toInput(v))
      })
      .catch((error) => toast.error(`加载对象存储设置失败: ${(error as Error).message}`))
    void refreshStats()
    const timer = setInterval(refreshStats, STATS_POLL_MS)
    return () => clearInterval(timer)
  }, [refreshStats])

  if (!form || !view) {
    return (
      <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[#A1A1A6]" />
      </div>
    )
  }

  const update = <K extends keyof StorageConfigInput>(key: K, value: StorageConfigInput[K]): void =>
    setForm({ ...form, [key]: value })

  const run = async (
    kind: NonNullable<typeof busy>,
    action: () => Promise<void>
  ): Promise<void> => {
    setBusy(kind)
    try {
      await action()
    } catch (error) {
      toast.error(
        (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      )
    } finally {
      setBusy(null)
      void refreshStats()
    }
  }

  const save = (): Promise<void> =>
    run('save', async () => {
      const next = await window.api.storage.saveConfig(form)
      setView(next)
      setForm(toInput(next))
      toast.success('对象存储设置已保存')
    })

  const test = (): Promise<void> =>
    run('test', async () => {
      const result = await window.api.storage.test()
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    })

  const enqueueAll = (): Promise<void> =>
    run('enqueue', async () => {
      const count = await window.api.storage.enqueueAll()
      toast.success(count > 0 ? `已把 ${count} 个作品排进上传队列` : '没有需要上传的作品')
    })

  const retryFailed = (): Promise<void> =>
    run('retry', async () => {
      const count = await window.api.storage.retryFailed()
      toast.success(`已重新排队 ${count} 个失败的作品`)
    })

  return (
    <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h2 className="text-base font-semibold text-[#1D1D1F]">对象存储</h2>
          <p className="text-xs text-[#A1A1A6] mt-1">
            支持 S3 兼容存储（Cloudflare R2、AWS S3、MinIO、阿里云 OSS、腾讯云 COS）。
            开启后新下载的作品会自动上传；本地文件暂时保留。
          </p>
        </div>
        <button
          type="button"
          onClick={() => update('enabled', !form.enabled)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
            form.enabled ? 'bg-[#0A84FF]' : 'bg-[#D1D1D6]'
          }`}
          aria-label="启用对象存储"
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              form.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      <div className="divide-y divide-[#E5E5E7]">
        <Field label="Endpoint" hint="例如 https://<账号ID>.r2.cloudflarestorage.com，不带 bucket">
          <input
            className={inputClass}
            value={form.endpoint}
            onChange={(e) => update('endpoint', e.target.value)}
            placeholder="https://"
          />
        </Field>
        <Field label="Region" hint="R2 填 auto">
          <input
            className={inputClass}
            value={form.region}
            onChange={(e) => update('region', e.target.value)}
          />
        </Field>
        <Field label="Bucket">
          <input
            className={inputClass}
            value={form.bucket}
            onChange={(e) => update('bucket', e.target.value)}
          />
        </Field>
        <Field label="Access Key ID">
          <input
            className={inputClass}
            value={form.accessKeyId}
            onChange={(e) => update('accessKeyId', e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label="Secret Access Key" hint="加密保存在系统钥匙串">
          <input
            className={inputClass}
            type="password"
            value={form.secretAccessKey ?? ''}
            onChange={(e) => update('secretAccessKey', e.target.value)}
            placeholder={view.hasSecretAccessKey ? '已保存，留空不修改' : ''}
            autoComplete="off"
          />
        </Field>
        <Field
          label="公开访问域名（可选）"
          hint="bucket 绑了 CDN / 自定义域名时填，否则用临时签名地址播放"
        >
          <input
            className={inputClass}
            value={form.publicBaseUrl}
            onChange={(e) => update('publicBaseUrl', e.target.value)}
            placeholder="https://media.example.com"
          />
        </Field>
        <Field label="上传中转（可选）" hint="国内直连 R2 不稳定时使用；最后一次重试会回退直传">
          <div className="flex flex-col gap-2 w-full md:w-[320px]">
            <input
              className={inputClass}
              value={form.relayUrl}
              onChange={(e) => update('relayUrl', e.target.value)}
              placeholder="https://relay.example.com"
            />
            <input
              className={inputClass}
              type="password"
              value={form.relayToken ?? ''}
              onChange={(e) => update('relayToken', e.target.value)}
              placeholder={view.hasRelayToken ? '中转 token 已保存，留空不修改' : '中转 token'}
              autoComplete="off"
            />
          </div>
        </Field>
        <Field label="同时上传作品数" hint="家宽上行是瓶颈，2 个一般就够">
          <input
            type="number"
            min={1}
            max={8}
            value={form.concurrency}
            onChange={(e) => update('concurrency', Number(e.target.value))}
            className="w-20 h-9 px-3 rounded-md bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono text-center focus:outline-none focus:border-[#0A84FF]"
          />
        </Field>
        <Field
          label="本地保留策略"
          hint="只留封面：上云并核对通过、过了保留期后删除本地的视频 / 图片 / 音乐，列表封面仍然秒开"
        >
          <select
            value={form.localPolicy}
            onChange={(e) =>
              update('localPolicy', e.target.value as StorageConfigInput['localPolicy'])
            }
            className={inputClass}
          >
            <option value="covers">只留封面（推荐）</option>
            <option value="keep">本地全部保留</option>
          </select>
        </Field>
        {form.localPolicy === 'covers' && (
          <Field label="保留期（天）" hint="上云后多少天再清理本地，0 表示核对通过就清理">
            <input
              type="number"
              min={0}
              max={365}
              value={form.graceDays}
              onChange={(e) => update('graceDays', Number(e.target.value))}
              className="w-20 h-9 px-3 rounded-md bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono text-center focus:outline-none focus:border-[#0A84FF]"
            />
          </Field>
        )}
        <Field
          label="取回缓存上限（GB）"
          hint="AI 分析等需要原文件时从云端取回，超过上限按最近使用淘汰"
        >
          <input
            type="number"
            min={1}
            value={form.cacheGb}
            onChange={(e) => update('cacheGb', Number(e.target.value))}
            className="w-20 h-9 px-3 rounded-md bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono text-center focus:outline-none focus:border-[#0A84FF]"
          />
        </Field>
      </div>

      <div className="flex flex-wrap justify-end gap-2 pt-4">
        <button
          type="button"
          onClick={test}
          disabled={busy !== null || !view.hasSecretAccessKey}
          className={secondaryButton}
        >
          {busy === 'test' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PlugZap className="h-4 w-4" />
          )}
          测试连接
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy !== null}
          className="h-9 px-4 rounded-lg bg-[#0A84FF] text-sm text-white font-medium hover:bg-[#0060D5] transition-colors disabled:opacity-50"
        >
          {busy === 'save' ? '保存中…' : '保存对象存储设置'}
        </button>
      </div>

      {stats && view.enabled && (
        <div className="mt-6 rounded-xl bg-[#F5F5F7] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-[#1D1D1F]">
              已上云 <span className="font-semibold">{stats.syncedPosts}</span> / {stats.totalPosts}{' '}
              个作品
              <span className="text-[#6E6E73]">
                {' '}
                · {formatBytes(stats.syncedBytes)} · 其中 {stats.cloudOnlyPosts} 个本地已清理
              </span>
            </p>
            <p className="text-xs text-[#6E6E73]">
              排队 {stats.queued} · 上传中 {stats.running} · 失败 {stats.failed}
            </p>
          </div>
          {stats.recentErrors.length > 0 && (
            <ul className="mt-3 space-y-1">
              {stats.recentErrors.map((e) => (
                <li key={e.awemeId} className="text-xs text-[#FF3B30] break-all">
                  {e.awemeId}：{e.error}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap justify-end gap-2 mt-4">
            {stats.failed > 0 && (
              <button
                type="button"
                onClick={retryFailed}
                disabled={busy !== null}
                className={secondaryButton}
              >
                <RotateCcw className="h-4 w-4" />
                重试失败
              </button>
            )}
            <button
              type="button"
              onClick={enqueueAll}
              disabled={busy !== null || stats.syncedPosts >= stats.totalPosts}
              className={secondaryButton}
              title="桶里已有同大小的文件会直接认领，不会重复上传"
            >
              <CloudUpload className="h-4 w-4" />
              上传现有作品
            </button>
          </div>
        </div>
      )}

      {view.enabled && view.hasSecretAccessKey && <StorageMigrationPanel />}
    </div>
  )
}
