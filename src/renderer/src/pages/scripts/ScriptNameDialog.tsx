import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { SCRIPT_HOOK_OPTIONS } from '@/lib/script-hooks'
import { HookParamHelp } from './HookParamHelp'

interface ScriptNameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  /** 重命名时带入原文件名，新建时为空 */
  initialFileName?: string
  /** 新建时选择钩子位置；重命名 / 复制模板时不要开 */
  pickTrigger?: boolean
  /** 返回后由父级刷新列表；抛错则保持弹窗打开 */
  onConfirm: (fileName: string, hook?: ScriptHookName | null) => Promise<void>
}

/** 补上 .js 后缀，用户只写主干名也能用 */
function withJsSuffix(input: string): string {
  const name = input.trim()
  return name.endsWith('.js') ? name : `${name}.js`
}

/** 新建 / 重命名脚本时的文件名输入弹窗 */
export function ScriptNameDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  initialFileName = '',
  pickTrigger = false,
  onConfirm
}: ScriptNameDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [hook, setHook] = useState<ScriptHookName | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(initialFileName)
    setHook(null)
  }, [open, initialFileName])

  const selected = SCRIPT_HOOK_OPTIONS.find((item) => item.value === hook) ?? SCRIPT_HOOK_OPTIONS[0]

  const handleConfirm = async (): Promise<void> => {
    const fileName = withJsSuffix(name)
    if (fileName === '.js') {
      toast.error('请输入文件名')
      return
    }
    setLoading(true)
    try {
      await onConfirm(fileName, pickTrigger ? hook : undefined)
      onOpenChange(false)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          pickTrigger ? 'sm:max-w-xl max-h-[min(85vh,760px)] overflow-y-auto' : 'sm:max-w-md'
        }
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Input
            autoFocus
            value={name}
            placeholder="my-script.js"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loading) handleConfirm()
            }}
          />
          <p className="text-xs text-[#A1A1A6]">
            {name.trim() ? `将保存为 ${withJsSuffix(name)}` : '不写 .js 后缀也会自动补上'}
          </p>
        </div>

        {pickTrigger && (
          <div className="space-y-2">
            <p className="text-sm text-[#1D1D1F]">什么时候运行</p>
            <div className="grid gap-1.5">
              {SCRIPT_HOOK_OPTIONS.map((item) => {
                const active = hook === item.value
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setHook(item.value)}
                    className={cn(
                      'w-full text-left rounded-lg border px-3 py-2 transition-colors',
                      active
                        ? 'border-[#0A84FF] bg-[#E8F0FE]'
                        : 'border-[#E5E5E7] bg-white hover:bg-[#F2F2F4]'
                    )}
                  >
                    <p
                      className={cn(
                        'text-sm',
                        active ? 'text-[#0A84FF] font-medium' : 'text-[#1D1D1F]'
                      )}
                    >
                      {item.label}
                    </p>
                    <p className="text-xs text-[#A1A1A6] mt-0.5">{item.hint}</p>
                  </button>
                )
              })}
            </div>
            <div className="rounded-lg bg-[#F5F5F7] border border-[#E5E5E7] px-3 py-2.5">
              <HookParamHelp option={selected} />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={loading || !name.trim()}>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
