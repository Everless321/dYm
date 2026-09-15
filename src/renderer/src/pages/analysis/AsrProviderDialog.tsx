import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  ASR_PROTOCOLS,
  ASR_PROVIDER_TEMPLATES,
  type AsrProtocol,
  type AsrProviderInput,
  type AsrProviderTemplate,
  type AsrProviderView
} from '@shared/ai'

interface AsrProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: AsrProviderView | null
  onSaved: (saved: AsrProviderView) => void
}

interface FormState {
  name: string
  protocol: AsrProtocol
  baseUrl: string
  model: string
  apiKey: string
  maxClipSeconds: string
  /** 一行一个 key=value */
  extraForm: string
}

const EMPTY_FORM: FormState = {
  name: '',
  protocol: 'openai-transcriptions',
  baseUrl: '',
  model: '',
  apiKey: '',
  maxClipSeconds: '600',
  extraForm: ''
}

function extraToText(extra: Record<string, string>): string {
  return Object.entries(extra)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

function textToExtra(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key) out[key] = value
  }
  return out
}

function formFromProvider(p: AsrProviderView): FormState {
  return {
    name: p.name,
    protocol: p.protocol,
    baseUrl: p.baseUrl,
    model: p.model,
    apiKey: '',
    maxClipSeconds: String(p.maxClipSeconds),
    extraForm: extraToText(p.extraForm)
  }
}

function formFromTemplate(t: AsrProviderTemplate): FormState {
  return {
    name: t.name,
    protocol: t.protocol,
    baseUrl: t.baseUrl,
    model: t.model,
    apiKey: '',
    maxClipSeconds: String(t.maxClipSeconds),
    extraForm: extraToText(t.extraForm ?? {})
  }
}

export function AsrProviderDialog({
  open,
  onOpenChange,
  provider,
  onSaved
}: AsrProviderDialogProps): React.JSX.Element {
  const [step, setStep] = useState<'template' | 'form'>('template')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [template, setTemplate] = useState<AsrProviderTemplate | null>(null)
  const [saving, setSaving] = useState(false)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    if (!open) return
    if (provider) {
      setForm(formFromProvider(provider))
      setTemplate(null)
      setStep('form')
    } else {
      setForm(EMPTY_FORM)
      setTemplate(null)
      setStep('template')
    }
  }, [open, provider])

  const toInput = (): AsrProviderInput => {
    const clip = parseInt(form.maxClipSeconds, 10)
    if (!Number.isFinite(clip) || clip < 10 || clip > 1800) {
      throw new Error('单段音频上限必须是 10-1800 之间的整数（秒）')
    }
    return {
      id: provider?.id,
      name: form.name.trim(),
      protocol: form.protocol,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      apiKey: form.apiKey ? form.apiKey : provider ? undefined : '',
      maxClipSeconds: clip,
      extraForm: textToExtra(form.extraForm)
    }
  }

  const handleVerify = async (): Promise<void> => {
    setVerifying(true)
    try {
      const result = await window.api.asr.verifyProvider(toInput())
      toast.success(result.message)
    } catch (error) {
      toast.error(`验证失败: ${(error as Error).message}`)
    } finally {
      setVerifying(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      const saved = await window.api.asr.saveProvider(toInput())
      toast.success('已保存')
      onSaved(saved)
      onOpenChange(false)
    } catch (error) {
      toast.error(`保存失败: ${(error as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const protocolMeta = ASR_PROTOCOLS.find((p) => p.value === form.protocol)
  const cn = ASR_PROVIDER_TEMPLATES.filter((t) => t.region === 'cn')
  const global = ASR_PROVIDER_TEMPLATES.filter((t) => t.region === 'global')

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{provider ? '编辑转写服务' : '添加语音转写服务'}</DialogTitle>
          <DialogDescription>
            {step === 'template'
              ? '选一个服务作为起点；都是云端 API，不需要本地模型'
              : '密钥只保存在本机，并使用系统安全存储加密'}
          </DialogDescription>
        </DialogHeader>

        {step === 'template' ? (
          <div className="space-y-4">
            <TemplateGroup
              title="国内"
              templates={cn}
              onPick={(t) => {
                setTemplate(t)
                setForm(formFromTemplate(t))
                setStep('form')
              }}
            />
            <TemplateGroup
              title="海外"
              templates={global}
              onPick={(t) => {
                setTemplate(t)
                setForm(formFromTemplate(t))
                setStep('form')
              }}
            />
            <button
              type="button"
              onClick={() => {
                setTemplate(null)
                setForm(EMPTY_FORM)
                setStep('form')
              }}
              className="w-full text-left rounded-xl border border-dashed border-[#D1D1D6] p-4 hover:border-[#0A84FF] transition-colors"
            >
              <p className="text-sm font-medium text-[#1D1D1F]">自定义</p>
              <p className="text-[11px] text-[#A1A1A6] mt-1">
                任何 OpenAI 兼容的 /audio/transcriptions 服务都可以手动填
              </p>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {template?.hint && (
              <p className="text-xs text-[#6E6E73] bg-[#F5F5F7] rounded-lg px-3 py-2">
                {template.hint}
              </p>
            )}
            <Field label="名称">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：硅基流动 SenseVoice"
              />
            </Field>

            <Field label="协议" hint={protocolMeta?.description}>
              <Select
                value={form.protocol}
                onValueChange={(v) => setForm({ ...form, protocol: v as AsrProtocol })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASR_PROTOCOLS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="接口地址">
              <Input
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="https://api.example.com/v1"
                className="font-mono"
              />
            </Field>

            <Field label="模型">
              <Input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="例如：whisper-large-v3-turbo"
                className="font-mono"
              />
            </Field>

            <Field
              label="API Key"
              hint={provider?.hasCredential ? '留空表示沿用已保存的密钥' : undefined}
            >
              <Input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder={provider?.hasCredential ? '••••••••（已保存）' : 'sk-…'}
                className="font-mono"
                autoComplete="off"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="单段音频上限（秒）" hint="接口限制的最长音频；更长的窗口会切片后拼接">
                <Input
                  type="number"
                  min={10}
                  max={1800}
                  value={form.maxClipSeconds}
                  onChange={(e) => setForm({ ...form, maxClipSeconds: e.target.value })}
                  className="font-mono"
                />
              </Field>
              {form.protocol === 'openai-transcriptions' && (
                <Field
                  label="额外表单字段"
                  hint="一行一个 key=value，如 response_format=verbose_json"
                >
                  <textarea
                    value={form.extraForm}
                    onChange={(e) => setForm({ ...form, extraForm: e.target.value })}
                    rows={2}
                    spellCheck={false}
                    className="w-full px-3 py-2 rounded-md bg-[#F5F5F7] border border-[#E5E5E7] text-xs font-mono text-[#1D1D1F] resize-none focus:outline-none focus:border-[#0A84FF]"
                  />
                </Field>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <div>
                {!provider && (
                  <Button type="button" variant="ghost" onClick={() => setStep('template')}>
                    返回模板
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleVerify}
                  disabled={verifying || saving}
                >
                  {verifying ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                  )}
                  验证连接
                </Button>
                <Button type="button" onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  保存
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TemplateGroup({
  title,
  templates,
  onPick
}: {
  title: string
  templates: AsrProviderTemplate[]
  onPick: (t: AsrProviderTemplate) => void
}): React.JSX.Element {
  return (
    <div>
      <p className="text-[11px] font-medium text-[#A1A1A6] mb-2">{title}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t)}
            className="text-left rounded-xl border border-[#E5E5E7] p-4 hover:border-[#0A84FF] hover:bg-[#F5F9FF] transition-colors"
          >
            <p className="text-sm font-medium text-[#1D1D1F]">{t.name}</p>
            <p className="text-[11px] text-[#A1A1A6] mt-1 font-mono truncate">{t.model}</p>
          </button>
        ))}
      </div>
    </div>
  )
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
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[#6E6E73]">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-[#A1A1A6]">{hint}</p>}
    </div>
  )
}
