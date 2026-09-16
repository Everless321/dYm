import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Star, Pencil, Trash2, KeyRound, ShieldAlert, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ASR_PROTOCOLS, type AsrProviderView } from '@shared/ai'
import { AsrProviderDialog } from './AsrProviderDialog'

interface AsrProvidersPanelProps {
  onChanged?: (providers: AsrProviderView[]) => void
}

function asrProtocolLabel(protocol: AsrProviderView['protocol']): string {
  return ASR_PROTOCOLS.find((p) => p.value === protocol)?.label ?? protocol
}

export function AsrProvidersPanel({ onChanged }: AsrProvidersPanelProps): React.JSX.Element {
  const [providers, setProviders] = useState<AsrProviderView[] | null>(null)
  const [editing, setEditing] = useState<AsrProviderView | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await window.api.asr.listProviders()
      setProviders(list)
      onChanged?.(list)
    } catch (error) {
      toast.error(`加载转写服务失败: ${(error as Error).message}`)
      setProviders((prev) => prev ?? [])
    }
  }, [onChanged])

  useEffect(() => {
    load()
  }, [load])

  const handleSetDefault = async (id: string): Promise<void> => {
    setBusyId(id)
    try {
      await window.api.asr.setDefaultProvider(id)
      await load()
    } catch (error) {
      toast.error(`设置失败: ${(error as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (p: AsrProviderView): Promise<void> => {
    if (!window.confirm(`删除转写服务「${p.name}」？排队中引用它的作业会改为不转写。`)) return
    setBusyId(p.id)
    try {
      await window.api.asr.deleteProvider(p.id)
      toast.success('已删除')
      await load()
    } catch (error) {
      toast.error(`删除失败: ${(error as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  const openCreate = (): void => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (p: AsrProviderView): void => {
    setEditing(p)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-[#1D1D1F]">语音转写服务</h3>
          <p className="text-xs text-[#A1A1A6] mt-0.5">
            把视频里的口播转成文字后一起交给模型理解；未配置时分析只看画面和文案
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          添加转写服务
        </Button>
      </div>

      {providers === null ? (
        <div className="py-12 text-center text-sm text-[#A1A1A6]">加载中…</div>
      ) : providers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#D1D1D6] bg-white py-14 text-center">
          <Mic className="h-10 w-10 text-[#E5E5E7] mx-auto mb-3" />
          <p className="text-sm text-[#6E6E73]">还没有配置语音转写服务</p>
          <p className="text-xs text-[#A1A1A6] mt-1 mb-4">
            预置硅基流动、阿里百炼、智谱、阶跃、OpenAI、Groq、Mistral、Gemini 等模板
          </p>
          <Button variant="outline" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            添加第一个转写服务
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {providers.map((p) => {
            const busy = busyId === p.id
            return (
              <div
                key={p.id}
                className={`rounded-2xl bg-white border p-5 shadow-sm transition-colors ${
                  p.isDefault ? 'border-[#0A84FF]' : 'border-[#E5E5E7]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-[#1D1D1F] truncate">{p.name}</p>
                      {p.isDefault && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#E8F0FE] text-[#0A84FF] font-medium shrink-0">
                          默认
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#6E6E73] mt-1">{asrProtocolLabel(p.protocol)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!p.isDefault && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        title="设为默认"
                        disabled={busy}
                        onClick={() => handleSetDefault(p.id)}
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title="编辑"
                      disabled={busy}
                      onClick={() => openEdit(p)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-[#EF4444] hover:text-[#EF4444]"
                      title="删除"
                      disabled={busy}
                      onClick={() => handleDelete(p)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <dl className="mt-4 space-y-1.5 text-xs">
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-[#A1A1A6]">模型</dt>
                    <dd className="font-mono text-[#1D1D1F] truncate">{p.model || '—'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-[#A1A1A6]">地址</dt>
                    <dd className="font-mono text-[#6E6E73] truncate">{p.baseUrl}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-[#A1A1A6]">单段上限</dt>
                    <dd className="text-[#6E6E73] tabular-nums">{p.maxClipSeconds} 秒</dd>
                  </div>
                  <div className="flex gap-2 items-center">
                    <dt className="w-14 shrink-0 text-[#A1A1A6]">凭据</dt>
                    <dd className="flex items-center gap-1.5">
                      {p.hasCredential ? (
                        <>
                          <KeyRound className="h-3.5 w-3.5 text-[#22C55E]" />
                          <span className="text-[#1D1D1F]">已保存</span>
                        </>
                      ) : (
                        <>
                          <ShieldAlert className="h-3.5 w-3.5 text-[#F59E0B]" />
                          <span className="text-[#6E6E73]">未设置</span>
                        </>
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            )
          })}
        </div>
      )}

      <AsrProviderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        provider={editing}
        onSaved={(saved) => {
          setEditing((prev) => (prev && prev.id === saved.id ? saved : prev))
          load()
        }}
      />
    </div>
  )
}
