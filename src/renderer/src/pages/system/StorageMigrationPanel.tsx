import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Eraser, Eye, Loader2, ShieldCheck } from 'lucide-react'
import type { MigrationStatus, PrunePreview } from '../../../../shared/storage'

const POLL_MS = 2000
const SNAPSHOT_TTL_MS = 30 * 60 * 1000
const FRACTIONS = [
  { value: 1 / 3, label: '最早的 1/3' },
  { value: 2 / 3, label: '最早的 2/3' },
  { value: 1, label: '全部' }
]
const secondaryButton =
  'h-9 px-4 rounded-lg border border-[#E5E5E7] bg-white text-sm text-[#1D1D1F] hover:bg-[#F2F2F4] transition-colors flex items-center gap-2 disabled:opacity-50'

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function errorText(error: unknown): string {
  return (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function Step({
  n,
  title,
  children
}: {
  n: number
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex gap-3 py-4">
      <div className="h-6 w-6 flex-shrink-0 rounded-full bg-[#0A84FF]/10 text-[#0A84FF] text-xs font-semibold flex items-center justify-center">
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#1D1D1F] font-medium">{title}</p>
        <div className="mt-1 text-xs text-[#6E6E73] space-y-2">{children}</div>
      </div>
    </div>
  )
}

/** 迁移向导：把已有作品库搬上云并清理本地（最早下载的先清） */
export function StorageMigrationPanel(): React.JSX.Element {
  const [status, setStatus] = useState<MigrationStatus | null>(null)
  const [fraction, setFraction] = useState(FRACTIONS[0].value)
  const [preview, setPreview] = useState<PrunePreview | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.api.storage.getMigrationStatus())
    } catch (error) {
      console.warn('读取迁移状态失败:', error)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(refresh, POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const running = Boolean(status?.task)
  const snapshotFresh =
    status?.snapshotAgeMs !== null &&
    status?.snapshotAgeMs !== undefined &&
    status.snapshotAgeMs < SNAPSHOT_TTL_MS

  const verify = async (): Promise<void> => {
    try {
      await window.api.storage.startVerify()
      setPreview(null)
      void refresh()
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  const runPreview = async (): Promise<void> => {
    setPreviewing(true)
    try {
      setPreview(await window.api.storage.previewPrune(fraction))
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setPreviewing(false)
    }
  }

  const prune = async (): Promise<void> => {
    if (!preview) return
    const ok = window.confirm(
      `将删除 ${preview.eligible} 个作品的本地视频 / 图片 / 音乐（约 ${gb(preview.bytes)}），只保留封面。\n` +
        '这些文件已确认在对象存储里，删除后播放会走云端。确定继续？'
    )
    if (!ok) return
    try {
      await window.api.storage.startPrune(fraction)
      setPreview(null)
      void refresh()
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-[#E5E5E7] px-4">
      <p className="pt-4 text-sm font-semibold text-[#1D1D1F]">迁移已有作品</p>

      <Step n={1} title="上传 / 认领现有作品">
        <p>
          点上面的「上传现有作品」，等「排队」和「上传中」都归零。桶里已有同大小的文件直接认领，不会重传。
        </p>
      </Step>

      <Step n={2} title="核对云端">
        <p>列出桶里的全部对象，逐个比对大小。对不上的作品会自动重新排队上传。</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={verify} disabled={running} className={secondaryButton}>
            {status?.task === 'verify' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            核对云端
          </button>
          {status?.task === 'verify' && (
            <span>
              {status.phase}… 已列出 {status.done} 个对象
            </span>
          )}
          {!running && snapshotFresh && (
            <span>桶清单 {Math.round((status?.snapshotAgeMs ?? 0) / 60000)} 分钟前</span>
          )}
        </div>
      </Step>

      <Step n={3} title="清理本地（只留封面）">
        <p>
          按下载时间从早到晚取一部分，三方（本地 / 上传记录 / 桶）大小都一致的才删。需要 30
          分钟内核对过。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={fraction}
            onChange={(e) => {
              setFraction(Number(e.target.value))
              setPreview(null)
            }}
            disabled={running}
            className="h-9 px-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F]"
          >
            {FRACTIONS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={runPreview}
            disabled={running || previewing || !snapshotFresh}
            className={secondaryButton}
          >
            {previewing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
            预览
          </button>
          <button
            type="button"
            onClick={prune}
            disabled={running || !preview || preview.eligible === 0}
            className="h-9 px-4 rounded-lg bg-[#FF3B30] text-sm text-white font-medium hover:bg-[#D70015] transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <Eraser className="h-4 w-4" />
            确认清理
          </button>
        </div>
        {preview && (
          <p className="text-[#1D1D1F]">
            取出 {preview.candidates} 个作品
            {preview.lastDownloadedAt &&
              `（下载时间截至 ${new Date(preview.lastDownloadedAt * 1000).toLocaleDateString()}）`}
            ：{preview.eligible} 个可清理，腾出约 {gb(preview.bytes)}
            {preview.blocked > 0 && `；${preview.blocked} 个没通过核对，不会删除`}
          </p>
        )}
        {status?.task === 'prune' && (
          <div>
            <div className="h-1.5 rounded-full bg-[#E5E5E7] overflow-hidden">
              <div
                className="h-full bg-[#0A84FF] transition-all"
                style={{ width: `${status.total ? (status.done / status.total) * 100 : 0}%` }}
              />
            </div>
            <p className="mt-1">
              {status.phase} {status.done} / {status.total}
            </p>
          </div>
        )}
      </Step>

      {!running && (status?.result || status?.error) && (
        <p
          className={`pb-4 text-xs ${status.error ? 'text-[#FF3B30]' : 'text-[#34C759]'} break-all`}
        >
          {status.error ?? status.result}
        </p>
      )}
    </div>
  )
}
