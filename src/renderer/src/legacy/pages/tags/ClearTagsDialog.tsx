import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

type Scope = 'all' | 'ai' | 'manual'

interface ClearTagsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  postIds: number[]
  /** 清除完成后回调（刷新） */
  onCleared?: () => void
  /** 勾选「清除后立即重标」时，把这些 postId 交给父级打开重标弹窗 */
  onReanalyze?: (postIds: number[]) => void
}

const SCOPES: { value: Scope; label: string; desc: string }[] = [
  { value: 'all', label: '全部标签', desc: '清除 AI 标签与手动标签' },
  { value: 'ai', label: '仅 AI 标签', desc: '清除 AI 生成的标签（回到未分析状态）' },
  { value: 'manual', label: '仅手动标签', desc: '清除手动添加的标签' }
]

export function ClearTagsDialog({
  open,
  onOpenChange,
  postIds,
  onCleared,
  onReanalyze
}: ClearTagsDialogProps) {
  const [scope, setScope] = useState<Scope>('all')
  const [reTag, setReTag] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setScope('all')
      setReTag(false)
    }
  }, [open])

  const handleConfirm = async () => {
    if (!postIds.length) return
    setLoading(true)
    try {
      await window.api.tag.clear(postIds, scope)
      toast.success(`已清除 ${postIds.length} 个视频的标签`)
      onCleared?.()
      onOpenChange(false)
      // 仅 AI / 全部 清除后才有意义重标
      if (reTag && scope !== 'manual') {
        onReanalyze?.(postIds)
      }
    } catch (error) {
      toast.error(`清除失败: ${(error as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>批量清除标签</DialogTitle>
          <DialogDescription>已选中 {postIds.length} 个视频</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              onClick={() => setScope(s.value)}
              className={`w-full text-left rounded-lg border p-3 transition-colors ${
                scope === s.value
                  ? 'border-[#0A84FF] bg-[#E8F0FE]'
                  : 'border-[#E5E5E7] hover:bg-[#F2F2F4]'
              }`}
            >
              <div className="text-sm font-medium text-[#1D1D1F]">{s.label}</div>
              <div className="text-xs text-[#A1A1A6] mt-0.5">{s.desc}</div>
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={reTag}
            onCheckedChange={(v) => setReTag(!!v)}
            disabled={scope === 'manual'}
          />
          <span className="text-sm text-[#1D1D1F]">清除后立即重新标记</span>
        </label>

        <div className="flex items-start gap-2 rounded-lg bg-[#FFF4E5] p-3 text-xs text-[#8A5A00]">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
          <span>操作不可撤销，仅清除选中类别的标签，其余保留。</span>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={loading || !postIds.length}>
            {loading ? '清除中…' : '确认清除'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
