import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, LogIn, LogOut, RefreshCw, Import } from 'lucide-react'
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
  AI_PROTOCOLS,
  AI_PROVIDER_TEMPLATES,
  type AiModelInfo,
  type AiProtocol,
  type AiProviderInput,
  type AiProviderTemplate,
  type AiProviderView,
  type AiReasoningEffort,
  type CodexAuthStatus
} from '@shared/ai'

interface ProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 编辑已有提供方；不传则新建 */
  provider: AiProviderView | null
  onSaved: (saved: AiProviderView) => void
}

const REASONING_OPTIONS: { value: AiReasoningEffort | 'default'; label: string }[] = [
  { value: 'default', label: '默认' },
  { value: 'none', label: '关闭' },
  { value: 'minimal', label: '最少' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' }
]

interface FormState {
  name: string
  protocol: AiProtocol
  baseUrl: string
  model: string
  apiKey: string
  reasoningEffort: AiReasoningEffort | 'default'
}

function formFromProvider(p: AiProviderView): FormState {
  return {
    name: p.name,
    protocol: p.protocol,
    baseUrl: p.baseUrl,
    model: p.model,
    apiKey: '',
    reasoningEffort: p.reasoningEffort ?? 'default'
  }
}

function formFromTemplate(t: AiProviderTemplate): FormState {
  return {
    name: t.name,
    protocol: t.protocol,
    baseUrl: t.baseUrl,
    model: t.model,
    apiKey: '',
    reasoningEffort: 'default'
  }
}

const EMPTY_FORM: FormState = {
  name: '',
  protocol: 'openai-chat',
  baseUrl: '',
  model: '',
  apiKey: '',
  reasoningEffort: 'default'
}

const supportsReasoning = (protocol: AiProtocol): boolean =>
  protocol === 'openai-responses' || protocol === 'codex'

export function ProviderDialog({
  open,
  onOpenChange,
  provider,
  onSaved
}: ProviderDialogProps): React.JSX.Element {
  // 新建时先选模板；编辑时直接进表单
  const [step, setStep] = useState<'template' | 'form'>('form')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  // 保存后拿到的 id（codex 登录需要先有记录）
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [models, setModels] = useState<AiModelInfo[] | null>(null)
  const [codexStatus, setCodexStatus] = useState<CodexAuthStatus | null>(null)
  const [codexBusy, setCodexBusy] = useState<'login' | 'import' | 'logout' | null>(null)

  // 只在打开或换了另一条提供方时重置表单；同一条保存后父级回传新对象不应打断正在编辑的状态
  const providerRef = useRef(provider)
  providerRef.current = provider
  const providerId = provider?.id ?? null
  useEffect(() => {
    if (!open) return
    const current = providerRef.current
    setModels(null)
    setCodexStatus(null)
    setCodexBusy(null)
    if (current) {
      setStep('form')
      setForm(formFromProvider(current))
      setSavedId(current.id)
    } else {
      setStep('template')
      setForm(EMPTY_FORM)
      setSavedId(null)
    }
  }, [open, providerId])

  const isCodex = form.protocol === 'codex'

  useEffect(() => {
    if (!open || !isCodex || !savedId) return
    let cancelled = false
    window.api.ai
      .codexStatus(savedId)
      .then((s) => !cancelled && setCodexStatus(s))
      .catch((error) => toast.error(`读取登录状态失败: ${(error as Error).message}`))
    return () => {
      cancelled = true
    }
  }, [open, isCodex, savedId])

  const toInput = (): AiProviderInput => ({
    id: savedId ?? undefined,
    name: form.name.trim(),
    protocol: form.protocol,
    baseUrl: form.baseUrl.trim(),
    model: form.model.trim(),
    // 编辑时留空表示不改密钥；新建时空串原样传过去（本地服务允许无 Key）
    apiKey: savedId && !form.apiKey ? undefined : form.apiKey,
    reasoningEffort: supportsReasoning(form.protocol)
      ? form.reasoningEffort === 'default'
        ? null
        : form.reasoningEffort
      : null
  })

  const validate = (): string | null => {
    if (!form.name.trim()) return '请填写名称'
    if (!isCodex && !form.baseUrl.trim()) return '请填写接口地址'
    if (!form.model.trim()) return '请填写模型'
    return null
  }

  const handleSave = async (keepOpen = false): Promise<AiProviderView | null> => {
    const problem = validate()
    if (problem) {
      toast.error(problem)
      return null
    }
    setSaving(true)
    try {
      const saved = await window.api.ai.saveProvider(toInput())
      setSavedId(saved.id)
      onSaved(saved)
      if (!keepOpen) onOpenChange(false)
      else toast.success('已保存，请继续登录')
      return saved
    } catch (error) {
      toast.error(`保存失败: ${(error as Error).message}`)
      return null
    } finally {
      setSaving(false)
    }
  }

  const handleVerify = async (): Promise<void> => {
    const problem = validate()
    if (problem) {
      toast.error(problem)
      return
    }
    setVerifying(true)
    try {
      const result = await window.api.ai.verifyProvider(toInput())
      toast.success(result.message)
    } catch (error) {
      toast.error(`验证失败: ${(error as Error).message}`)
    } finally {
      setVerifying(false)
    }
  }

  const handleLoadModels = async (): Promise<void> => {
    if (!isCodex && !form.baseUrl.trim()) {
      toast.error('请先填写接口地址')
      return
    }
    setLoadingModels(true)
    try {
      const list = await window.api.ai.listModels(toInput())
      if (list === null) {
        toast.info('该协议不提供模型列表，请手动填写模型名')
        return
      }
      setModels(list)
      if (!list.length) toast.info('接口没有返回任何模型')
    } catch (error) {
      toast.error(`获取模型列表失败: ${(error as Error).message}`)
    } finally {
      setLoadingModels(false)
    }
  }

  const runCodex = async (
    action: 'login' | 'import' | 'logout',
    fn: (id: string) => Promise<CodexAuthStatus>
  ): Promise<void> => {
    let id = savedId
    if (!id) {
      const saved = await handleSave(true)
      if (!saved) return
      id = saved.id
    }
    setCodexBusy(action)
    try {
      const status = await fn(id)
      setCodexStatus(status)
      if (action === 'logout') toast.success('已退出登录')
      else toast.success(status.email ? `已登录：${status.email}` : '登录成功')
      // 登录态存在提供方记录里，列表要刷新 hasCredential
      const list = await window.api.ai.listProviders()
      const fresh = list.find((p) => p.id === id)
      if (fresh) onSaved(fresh)
    } catch (error) {
      toast.error(`${action === 'logout' ? '退出' : '登录'}失败: ${(error as Error).message}`)
    } finally {
      setCodexBusy(null)
    }
  }

  const cancelLogin = async (): Promise<void> => {
    try {
      await window.api.ai.codexCancelLogin()
    } catch {
      /* 取消失败无妨，登录 promise 会自己超时 */
    }
  }

  const modelOptions = useMemo(() => {
    if (!models) return null
    const ids = new Set(models.map((m) => m.id))
    // 手填的模型不在列表里时也保留，避免下拉框显示为空
    if (form.model && !ids.has(form.model)) {
      return [{ id: form.model, label: `${form.model}（自定义）` }, ...models]
    }
    return models
  }, [models, form.model])

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && !codexBusy && onOpenChange(o)}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{provider ? '编辑提供方' : '添加 AI 提供方'}</DialogTitle>
          <DialogDescription>
            {step === 'template'
              ? '选一个常用服务作为起点，或从空白开始自定义'
              : '密钥只保存在本机，并使用系统安全存储加密'}
          </DialogDescription>
        </DialogHeader>

        {step === 'template' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {AI_PROVIDER_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setForm(formFromTemplate(t))
                  setStep('form')
                }}
                className="text-left rounded-xl border border-[#E5E5E7] p-4 hover:border-[#0A84FF] hover:bg-[#F5F9FF] transition-colors"
              >
                <p className="text-sm font-medium text-[#1D1D1F]">{t.name}</p>
                <p className="text-[11px] text-[#A1A1A6] mt-1 line-clamp-2">
                  {AI_PROTOCOLS.find((p) => p.value === t.protocol)?.label}
                </p>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setForm(EMPTY_FORM)
                setStep('form')
              }}
              className="text-left rounded-xl border border-dashed border-[#D1D1D6] p-4 hover:border-[#0A84FF] transition-colors"
            >
              <p className="text-sm font-medium text-[#1D1D1F]">自定义</p>
              <p className="text-[11px] text-[#A1A1A6] mt-1">手动填写协议、地址与模型</p>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="名称">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例如：xAI Grok"
              />
            </Field>

            <Field
              label="协议"
              hint={AI_PROTOCOLS.find((p) => p.value === form.protocol)?.description}
            >
              <Select
                value={form.protocol}
                onValueChange={(v) => {
                  const protocol = v as AiProtocol
                  const template = AI_PROVIDER_TEMPLATES.find((t) => t.protocol === protocol)
                  setModels(null)
                  setForm({
                    ...form,
                    protocol,
                    // 换到 codex 时地址固定；从 codex 换出来时给一个协议对应的默认地址
                    baseUrl:
                      protocol === 'codex'
                        ? (template?.baseUrl ?? '')
                        : form.protocol === 'codex'
                          ? (template?.baseUrl ?? '')
                          : form.baseUrl
                  })
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_PROTOCOLS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {!isCodex && (
              <Field label="接口地址">
                <Input
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                  placeholder="https://api.example.com/v1"
                  className="font-mono"
                />
              </Field>
            )}

            <Field label="模型">
              <div className="flex gap-2">
                {modelOptions ? (
                  <Select value={form.model} onValueChange={(v) => setForm({ ...form, model: v })}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {modelOptions.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label ?? m.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    placeholder="模型名，需支持图片输入"
                    className="flex-1 font-mono"
                  />
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleLoadModels}
                  disabled={loadingModels}
                  title="从接口拉取可用模型"
                >
                  {loadingModels ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  <span className="ml-1">获取列表</span>
                </Button>
              </div>
            </Field>

            {!isCodex && (
              <Field
                label="API Key"
                hint={
                  savedId && provider?.hasCredential
                    ? '已保存，留空表示不修改'
                    : '本地服务（Ollama / LM Studio）可留空'
                }
              >
                <Input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  placeholder={savedId && provider?.hasCredential ? '••••••••' : 'sk-...'}
                  className="font-mono"
                  autoComplete="off"
                />
              </Field>
            )}

            {supportsReasoning(form.protocol) && (
              <Field label="推理深度" hint="仅推理模型有效；越高越慢越贵，打标签一般用低或关闭即可">
                <Select
                  value={form.reasoningEffort}
                  onValueChange={(v) =>
                    setForm({ ...form, reasoningEffort: v as FormState['reasoningEffort'] })
                  }
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REASONING_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {isCodex && (
              <div className="rounded-xl border border-[#E5E5E7] bg-[#F5F5F7] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-[#1D1D1F]">ChatGPT 账号</p>
                    <p className="text-xs text-[#A1A1A6] mt-0.5">
                      {!savedId
                        ? '点下方按钮会先保存本条配置，再打开浏览器授权'
                        : codexStatus === null
                          ? '读取中…'
                          : codexStatus.loggedIn
                            ? `已登录${codexStatus.email ? `：${codexStatus.email}` : ''}`
                            : '未登录'}
                    </p>
                  </div>
                  {codexStatus?.loggedIn && (
                    <CheckCircle2 className="h-5 w-5 text-[#22C55E] shrink-0" />
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {codexBusy === 'login' ? (
                    <Button type="button" variant="outline" onClick={cancelLogin}>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      等待浏览器授权…（点击取消）
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant={codexStatus?.loggedIn ? 'outline' : 'default'}
                      disabled={!!codexBusy || saving}
                      onClick={() => runCodex('login', (id) => window.api.ai.codexLogin(id))}
                    >
                      <LogIn className="h-4 w-4 mr-1" />
                      {codexStatus?.loggedIn ? '重新登录' : '登录 ChatGPT'}
                    </Button>
                  )}
                  {(codexStatus?.cliAuthAvailable ?? true) && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!!codexBusy || saving}
                      onClick={() =>
                        runCodex('import', (id) => window.api.ai.codexImportFromCli(id))
                      }
                    >
                      {codexBusy === 'import' ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Import className="h-4 w-4 mr-1" />
                      )}
                      从 Codex CLI 导入
                    </Button>
                  )}
                  {codexStatus?.loggedIn && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={!!codexBusy}
                      onClick={() => runCodex('logout', (id) => window.api.ai.codexLogout(id))}
                    >
                      {codexBusy === 'logout' ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <LogOut className="h-4 w-4 mr-1" />
                      )}
                      退出登录
                    </Button>
                  )}
                </div>
              </div>
            )}

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
                <Button type="button" onClick={() => handleSave(false)} disabled={saving}>
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
