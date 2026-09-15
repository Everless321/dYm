import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ANALYSIS_DEFAULTS, ANALYSIS_OUTPUT_FIELDS, type AnalysisSettings } from '@shared/ai'

interface Draft {
  prompt: string
  slices: string
  concurrency: string
  rpm: string
  tagMode: AnalysisSettings['tagMode']
  autoAnalyze: boolean
}

function toDraft(s: AnalysisSettings): Draft {
  return {
    prompt: s.prompt,
    slices: String(s.slices),
    concurrency: String(s.concurrency),
    rpm: String(s.rpm),
    tagMode: s.tagMode,
    autoAnalyze: s.autoAnalyze
  }
}

export function SettingsPanel(): React.JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.analysis
      .getSettings()
      .then((s) => setDraft(toDraft(s)))
      .catch((error) => {
        toast.error(`加载分析设置失败: ${(error as Error).message}`)
        setDraft(toDraft(ANALYSIS_DEFAULTS))
      })
  }, [])

  const update = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))

  const parseIntField = (value: string, label: string): number => {
    const n = parseInt(value, 10)
    if (!Number.isFinite(n) || n < 1) throw new Error(`${label} 必须是不小于 1 的整数`)
    return n
  }

  const handleSave = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      const saved = await window.api.analysis.saveSettings({
        prompt: draft.prompt,
        slices: parseIntField(draft.slices, '截帧数'),
        concurrency: parseIntField(draft.concurrency, '并发数'),
        rpm: parseIntField(draft.rpm, '每分钟请求数'),
        tagMode: draft.tagMode,
        autoAnalyze: draft.autoAnalyze
      })
      setDraft(toDraft(saved))
      toast.success('分析设置已保存，对之后新建的作业生效')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // 自动分析开关单独即时保存：它更像一个全局开关，不该被「保存」按钮挡住
  const handleToggleAuto = async (value: boolean): Promise<void> => {
    if (!draft) return
    const before = draft.autoAnalyze
    update('autoAnalyze', value)
    try {
      await window.api.analysis.saveSettings({ autoAnalyze: value })
    } catch (error) {
      update('autoAnalyze', before)
      toast.error(`保存失败: ${(error as Error).message}`)
    }
  }

  if (!draft) {
    return <div className="py-12 text-center text-sm text-[#A1A1A6]">加载中…</div>
  }

  const promptIsDefault = draft.prompt.trim() === ANALYSIS_DEFAULTS.prompt.trim()

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* 提示词 */}
      <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6 flex flex-col">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-[15px] font-semibold text-[#1D1D1F]">分析指令</h3>
            <p className="text-xs text-[#A1A1A6] mt-1">
              告诉模型关注什么、用哪套标签体系。所有提供方共用这一份；输出格式由程序自动追加，不必在这里写
              JSON 要求。
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={promptIsDefault}
            onClick={() => update('prompt', ANALYSIS_DEFAULTS.prompt)}
            title="恢复内置默认指令"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            恢复默认
          </Button>
        </div>
        <textarea
          value={draft.prompt}
          onChange={(e) => update('prompt', e.target.value)}
          rows={18}
          spellCheck={false}
          className="w-full flex-1 min-h-[320px] px-3 py-3 rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] text-[13px] text-[#1D1D1F] leading-relaxed font-mono resize-y focus:outline-none focus:border-[#0A84FF]"
        />
        <div className="mt-3 rounded-lg bg-[#F5F5F7] border border-dashed border-[#D1D1D6] p-3">
          <p className="text-[11px] font-medium text-[#6E6E73] mb-1.5">程序自动追加的输出要求</p>
          <ul className="text-[11px] text-[#A1A1A6] font-mono space-y-0.5">
            {ANALYSIS_OUTPUT_FIELDS.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* 参数 */}
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
          <h3 className="text-[15px] font-semibold text-[#1D1D1F] mb-2">运行参数</h3>
          <div className="divide-y divide-[#F2F2F4]">
            <NumberRow
              label="截帧数"
              hint="每个视频抽取的画面数；图集取前 N 张"
              value={draft.slices}
              onChange={(v) => update('slices', v)}
              max={20}
            />
            <NumberRow
              label="并发数"
              hint="同时分析的作品数"
              value={draft.concurrency}
              onChange={(v) => update('concurrency', v)}
              max={16}
            />
            <NumberRow
              label="每分钟请求数"
              hint="按提供方限流，超出会排队等待"
              value={draft.rpm}
              onChange={(v) => update('rpm', v)}
              max={600}
            />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
          <h3 className="text-[15px] font-semibold text-[#1D1D1F] mb-2">标签策略</h3>
          <div className="space-y-2 mt-3">
            <ModeOption
              active={draft.tagMode === 'open'}
              onClick={() => update('tagMode', 'open')}
              title="开放模式"
              desc="模型输出的标签经归一化后全部保留，标签库随之增长"
            />
            <ModeOption
              active={draft.tagMode === 'closed'}
              onClick={() => update('tagMode', 'closed')}
              title="封闭模式"
              desc="只保留标签库中已有（含别名）的标签，适合体系已稳定后使用"
            />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[#1D1D1F]">下载后自动分析</p>
              <p className="text-xs text-[#A1A1A6] mt-1">
                新作品下载完成后自动合批加入队列，使用默认提供方
              </p>
            </div>
            <Switch checked={draft.autoAnalyze} onCheckedChange={handleToggleAuto} />
          </div>
        </div>

        <Button className="w-full" onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          保存设置
        </Button>
      </div>
    </div>
  )
}

function NumberRow({
  label,
  hint,
  value,
  onChange,
  max
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  max: number
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between py-3 gap-3">
      <div className="min-w-0">
        <p className="text-sm text-[#1D1D1F]">{label}</p>
        <p className="text-[11px] text-[#A1A1A6] mt-0.5">{hint}</p>
      </div>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={1}
        max={max}
        className="w-20 h-9 px-3 rounded-md bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono text-center focus:outline-none focus:border-[#0A84FF]"
      />
    </div>
  )
}

function ModeOption({
  active,
  onClick,
  title,
  desc
}: {
  active: boolean
  onClick: () => void
  title: string
  desc: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 transition-colors ${
        active ? 'border-[#0A84FF] bg-[#F5F9FF]' : 'border-[#E5E5E7] hover:bg-[#F5F5F7]'
      }`}
    >
      <p className={`text-sm font-medium ${active ? 'text-[#0A84FF]' : 'text-[#1D1D1F]'}`}>
        {title}
      </p>
      <p className="text-[11px] text-[#A1A1A6] mt-0.5">{desc}</p>
    </button>
  )
}
