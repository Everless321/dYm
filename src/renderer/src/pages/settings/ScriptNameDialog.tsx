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

interface ScriptNameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  /** 重命名时带入原文件名，新建时为空 */
  initialFileName?: string
  /** 返回后由父级刷新列表；抛错则保持弹窗打开 */
  onConfirm: (fileName: string) => Promise<void>
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
  onConfirm
}: ScriptNameDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) setName(initialFileName)
  }, [open, initialFileName])

  const handleConfirm = async (): Promise<void> => {
    const fileName = withJsSuffix(name)
    if (fileName === '.js') {
      toast.error('请输入文件名')
      return
    }
    setLoading(true)
    try {
      await onConfirm(fileName)
      onOpenChange(false)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
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
