import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ANALYSIS_DEFAULTS, type AnalysisMosaicMode, type AnalysisSettings } from '@shared/ai'

type NumericKey =
  | 'framesShort'
  | 'framesPerSegment'
  | 'segmentSeconds'
  | 'maxMinutes'
  | 'skipOverMinutes'
  | 'asrRpm'
  | 'concurrency'
  | 'rpm'

interface Draft extends Record<NumericKey, string> {
  prompt: string
  mosaic: AnalysisMosaicMode
  transcribe: boolean
  tagMode: AnalysisSettings['tagMode']
  autoAnalyze: boolean
}

const NUMERIC: { key: NumericKey; label: string; hint: string; min: number; max: number }[] = [
  {
    key: 'framesShort',
    label: '短视频帧数',
    hint: '≤60 秒的视频最多送几帧；场景检测去重后通常更少。图集取前 N 张',
    min: 1,
    max: 30
  },
  {
    key: 'framesPerSegment',
    label: '每段帧数',
    hint: '长视频每一段最多送几帧',
    min: 1,
    max: 16
  },
  {
    key: 'segmentSeconds',
    label: '分段长度（秒）',
    hint: '长视频按此切段逐段理解，最后汇总',
    min: 30,
    max: 300
  },
  {
    key: 'maxMinutes',
    label: '最多分析（分钟）',
    hint: '超过这个时长只在全片范围内均匀抽样这么多分钟，首尾必取',
    min: 1,
    max: 240
  },
  {
    key: 'skipOverMinutes',
    label: '超过则跳过（分钟）',
    hint: '再长的视频直接标记跳过，不消耗额度',
    min: 1,
    max: 1440
  }
]

const RATE: { key: NumericKey; label: string; hint: string; min: number; max: number }[] = [
  { key: 'concurrency', label: '并发数', hint: '同时分析的作品数', min: 1, max: 16 },
  {
    key: 'rpm',
    label: '模型每分钟请求数',
    hint: '按 AI 提供方限流，超出会排队等待',
    min: 1,
    max: 600
  },
  {
    key: 'asrRpm',
    label: '转写每分钟请求数',
    hint: '按转写提供方独立限流；单段上限小的服务（如 30 秒）请求数会多',
    min: 1,
    max: 600
  }
]

function toDraft(s: AnalysisSettings): Draft {
  return {
    prompt: s.prompt,
    framesShort: String(s.framesShort),
    framesPerSegment: String(s.framesPerSegment),
    segmentSeconds: String(s.segmentSeconds),
    maxMinutes: String(s.maxMinutes),
    skipOverMinutes: String(s.skipOverMinutes),
    asrRpm: String(s.asrRpm),
    concurrency: String(s.concurrency),
    rpm: String(s.rpm),
    mosaic: s.mosaic,
    transcribe: s.transcribe,
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

  const parseIntField = (value: string, label: string, min: number, max: number): number => {
    const n = parseInt(value, 10)
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new Error(`${label} 必须是 ${min}-${max} 之间的整数`)
    }
    return n
  }

  const handleSave = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      const patch: Partial<AnalysisSettings> = {
        prompt: draft.prompt,
        mosaic: draft.mosaic,
        transcribe: draft.transcribe,
        tagMode: draft.tagMode,
        autoAnalyze: draft.autoAnalyze
      }
      for (const field of [...NUMERIC, ...RATE]) {
        patch[field.key] = parseIntField(draft[field.key], field.label, field.min, field.max)
      }
      const saved = await window.api.analysis.saveSettings(patch)
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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* 提示词 */}
      <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6 flex flex-col">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-[15px] font-semibold text-[#1D1D1F]">分析指令</h3>
            <p className="text-xs text-[#A1A1A6] mt-1">
              告诉模型关注什么、用哪套标签体系。所有提供方共用这一份；输出的 JSON
              结构（摘要、分类、人物、场景、评分、分面标签、章节）由程序自动追加，不必在这里写。
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
          <p className="text-[11px] font-medium text-[#6E6E73] mb-1.5">分析流程</p>
          <p className="text-[11px] text-[#A1A1A6] leading-relaxed">
            探测时长 → 分段规划 → 每段：语音转写 + 场景检测抽帧 → 模型理解 → 长视频再做一次整片汇总
            → 写入摘要 / 分面标签 / 章节 / 字幕。≤60 秒的短视频与图集一次完成。
          </p>
        </div>
      </div>

      {/* 参数 */}
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
          <h3 className="text-[15px] font-semibold text-[#1D1D1F] mb-2">画面与长度</h3>
          <div className="divide-y divide-[#F2F2F4]">
            {NUMERIC.map((f) => (
              <NumberRow
                key={f.key}
                label={f.label}
                hint={f.hint}
                value={draft[f.key]}
                onChange={(v) => update(f.key, v)}
                min={f.min}
                max={f.max}
              />
            ))}
            <div className="py-3">
              <p className="text-sm text-[#1D1D1F]">长视频拼图</p>
              <p className="text-[11px] text-[#A1A1A6] mt-0.5 mb-2">
                把每段的帧拼成一张网格图，一段只算一张图的 token；细节会损失一些
              </p>
              <div className="inline-flex h-8 items-center rounded-lg bg-[#F2F2F4] p-0.5">
                {(
                  [
                    ['auto', '10 分钟以上'],
                    ['on', '总是'],
                    ['off', '从不']
                  ] as [AnalysisMosaicMode, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => update('mosaic', value)}
                    className={`h-7 px-3 rounded-md text-xs transition-colors ${
                      draft.mosaic === value
                        ? 'bg-white text-[#1D1D1F] shadow-sm font-medium'
                        : 'text-[#6E6E73] hover:text-[#1D1D1F]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-[#1D1D1F]">语音转写</p>
              <p className="text-xs text-[#A1A1A6] mt-1">
                把视频里的话转成文字一起交给模型；需要在「转写服务」里配置提供方，没配置时自动跳过
              </p>
            </div>
            <Switch checked={draft.transcribe} onCheckedChange={(v) => update('transcribe', v)} />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm p-6">
          <h3 className="text-[15px] font-semibold text-[#1D1D1F] mb-2">并发与限流</h3>
          <div className="divide-y divide-[#F2F2F4]">
            {RATE.map((f) => (
              <NumberRow
                key={f.key}
                label={f.label}
                hint={f.hint}
                value={draft[f.key]}
                onChange={(v) => update(f.key, v)}
                min={f.min}
                max={f.max}
              />
            ))}
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
  min,
  max
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  min: number
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
        min={min}
        max={max}
        className="w-20 h-9 px-3 rounded-md bg-[#F5F5F7] border border-[#E5E5E7] text-sm text-[#1D1D1F] font-mono text-center focus:outline-none focus:border-[#0A84FF] shrink-0"
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
