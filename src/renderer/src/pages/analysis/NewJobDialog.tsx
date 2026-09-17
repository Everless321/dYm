import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Loader2, Search, Sparkles } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { AiProviderView, AnalysisJobView, AsrProviderView } from '@shared/ai'
import { analysisPath } from './shared'

interface NewJobDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  providers: AiProviderView[]
  asrProviders: AsrProviderView[]
  onCreated: (job: AnalysisJobView) => void
  onNeedProvider: () => void
}

const ALL = '__all__'
const DEFAULT_PROVIDER = '__default__'

export function NewJobDialog({
  open,
  onOpenChange,
  providers,
  asrProviders,
  onCreated,
  onNeedProvider
}: NewJobDialogProps): React.JSX.Element {
  const [userStats, setUserStats] = useState<UserAnalysisStats[]>([])
  const [totals, setTotals] = useState<TotalAnalysisStats | null>(null)
  const [secUid, setSecUid] = useState(ALL)
  const [search, setSearch] = useState('')
  const [onlyUnanalyzed, setOnlyUnanalyzed] = useState(true)
  const [providerId, setProviderId] = useState(DEFAULT_PROVIDER)
  const [asrProviderId, setAsrProviderId] = useState(DEFAULT_PROVIDER)
  const [transcribeEnabled, setTranscribeEnabled] = useState<boolean | null>(null)
  const [priority, setPriority] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!open) return
    setSecUid(ALL)
    setSearch('')
    setOnlyUnanalyzed(true)
    setProviderId(DEFAULT_PROVIDER)
    setAsrProviderId(DEFAULT_PROVIDER)
    setPriority(false)
    Promise.all([window.api.analysis.getUserStats(), window.api.analysis.getTotalStats()])
      .then(([users, total]) => {
        setUserStats(users)
        setTotals(total)
      })
      .catch((error) => toast.error(`加载统计失败: ${(error as Error).message}`))
    window.api.analysis
      .getSettings()
      .then((s) => setTranscribeEnabled(s.transcribe))
      .catch(() => setTranscribeEnabled(null))
  }, [open])

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q ? userStats.filter((u) => u.nickname.toLowerCase().includes(q)) : userStats
    // 有待分析的排前面
    return [...list].sort((a, b) => b.unanalyzed - a.unanalyzed)
  }, [userStats, search])

  const selectedUser = userStats.find((u) => u.sec_uid === secUid)
  const estimate = (() => {
    if (secUid === ALL) {
      if (!totals) return null
      return onlyUnanalyzed ? totals.unanalyzed : totals.total
    }
    if (!selectedUser) return null
    return onlyUnanalyzed ? selectedUser.unanalyzed : selectedUser.total
  })()

  const defaultProvider = providers.find((p) => p.isDefault) ?? providers[0]
  const defaultAsr = asrProviders.find((p) => p.isDefault) ?? asrProviders[0]

  const handleCreate = async (): Promise<void> => {
    if (!providers.length) {
      onNeedProvider()
      return
    }
    setCreating(true)
    try {
      const job = await window.api.analysis.createJob({
        kind: 'analyze',
        secUid: secUid === ALL ? undefined : secUid,
        onlyUnanalyzed,
        providerId: providerId === DEFAULT_PROVIDER ? undefined : providerId,
        asrProviderId: asrProviderId === DEFAULT_PROVIDER ? undefined : asrProviderId,
        priority
      })
      toast.success(`已加入队列：${job.name}`)
      onCreated(job)
      onOpenChange(false)
    } catch (error) {
      toast.error(`创建失败: ${(error as Error).message}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !creating && onOpenChange(o)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>新建分析作业</DialogTitle>
          <DialogDescription>
            作业会进入队列按顺序执行，可随时暂停或取消；关闭窗口不影响后台运行
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#6E6E73]">范围</label>
            <div className="rounded-lg border border-[#E5E5E7] overflow-hidden">
              <div className="p-2 border-b border-[#E5E5E7] bg-[#FAFAFA]">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#A1A1A6]" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜索用户…"
                    className="w-full h-8 pl-8 pr-3 rounded-md bg-white border border-[#E5E5E7] text-sm focus:outline-none focus:border-[#0A84FF]"
                  />
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {!search && (
                  <ScopeRow
                    active={secUid === ALL}
                    onClick={() => setSecUid(ALL)}
                    label="全部用户"
                    meta={totals ? `${totals.analyzed}/${totals.total}` : ''}
                    pending={totals?.unanalyzed ?? 0}
                  />
                )}
                {filteredUsers.map((u) => (
                  <ScopeRow
                    key={u.sec_uid}
                    active={secUid === u.sec_uid}
                    onClick={() => setSecUid(u.sec_uid)}
                    label={u.nickname}
                    meta={`${u.analyzed}/${u.total}`}
                    pending={u.unanalyzed}
                  />
                ))}
                {search && filteredUsers.length === 0 && (
                  <div className="px-3 py-4 text-sm text-[#A1A1A6] text-center">未找到匹配用户</div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-[#E5E5E7] px-3 py-2.5">
            <div>
              <p className="text-sm text-[#1D1D1F]">仅分析未分析过的作品</p>
              <p className="text-[11px] text-[#A1A1A6] mt-0.5">
                关闭后会重新分析范围内全部作品，AI 标签将被覆盖（手动标签保留）
              </p>
            </div>
            <Switch checked={onlyUnanalyzed} onCheckedChange={setOnlyUnanalyzed} />
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#6E6E73]">提供方</label>
              {providers.length ? (
                <Select value={providerId} onValueChange={setProviderId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_PROVIDER}>
                      默认{defaultProvider ? `（${defaultProvider.name}）` : ''}
                    </SelectItem>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} · {p.model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <button
                  type="button"
                  onClick={onNeedProvider}
                  className="w-full h-9 px-3 rounded-md border border-dashed border-[#F59E0B] text-sm text-[#B45309] bg-[#FFFBEB] text-left"
                >
                  尚未配置 AI 提供方，点击前往配置
                </button>
              )}
            </div>
            <label className="flex items-center gap-2 h-9 text-sm text-[#1D1D1F] select-none">
              <Switch checked={priority} onCheckedChange={setPriority} />
              插队优先
            </label>
          </div>

          {transcribeEnabled && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#6E6E73]">语音转写</label>
              {asrProviders.length ? (
                <Select value={asrProviderId} onValueChange={setAsrProviderId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_PROVIDER}>
                      默认{defaultAsr ? `（${defaultAsr.name}）` : ''}
                    </SelectItem>
                    {asrProviders.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} · {p.model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Link
                  to={analysisPath('asr')}
                  onClick={() => onOpenChange(false)}
                  className="block w-full h-9 px-3 leading-9 rounded-md border border-dashed border-[#D1D1D6] text-sm text-[#6E6E73] bg-[#FAFAFA] hover:border-[#0A84FF] hover:text-[#0A84FF] transition-colors"
                >
                  未配置转写服务，本次只看画面和文案；点击前往配置
                </Link>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-[#6E6E73]">
            {estimate === null ? '' : `预计 ${estimate.toLocaleString()} 条作品`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={creating || estimate === 0}>
              {creating ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-1" />
              )}
              加入队列
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ScopeRow({
  active,
  onClick,
  label,
  meta,
  pending
}: {
  active: boolean
  onClick: () => void
  label: string
  meta: string
  pending: number
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-3 py-2 text-left flex items-center justify-between gap-3 hover:bg-[#F5F5F7] transition-colors ${
        active ? 'bg-[#F5F9FF]' : ''
      }`}
    >
      <span
        className={`text-sm truncate ${active ? 'text-[#0A84FF] font-medium' : 'text-[#1D1D1F]'}`}
      >
        {label}
      </span>
      <span className="flex items-center gap-2 shrink-0 text-xs">
        {pending > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-[#E8F0FE] text-[#0A84FF]">待 {pending}</span>
        )}
        <span className="text-[#A1A1A6] tabular-nums">{meta}</span>
      </span>
    </button>
  )
}
