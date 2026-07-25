import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Plus, X } from 'lucide-react'
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

interface AddTagsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  postIds: number[]
  onAdded?: () => void
}

const SUGGESTION_LIMIT = 24

/** 批量给选中视频追加手动标签 */
export function AddTagsDialog({
  open,
  onOpenChange,
  postIds,
  onAdded
}: AddTagsDialogProps): React.JSX.Element {
  const [picked, setPicked] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [library, setLibrary] = useState<TagFrequencyItem[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setPicked([])
    setInput('')
    window.api.tag.getTagsWithFrequency().then(setLibrary)
  }, [open])

  const suggestions = useMemo(() => {
    const kw = input.trim().toLowerCase()
    const pool = kw ? library.filter((t) => t.tag.toLowerCase().includes(kw)) : library
    return pool.filter((t) => !picked.includes(t.tag)).slice(0, SUGGESTION_LIMIT)
  }, [library, input, picked])

  const add = (tag: string): void => {
    const t = tag.trim()
    if (!t || picked.includes(t)) return
    setPicked((prev) => [...prev, t])
    setInput('')
  }

  const submit = async (): Promise<void> => {
    if (!picked.length) return
    setSaving(true)
    try {
      const n = await window.api.tag.addTags(postIds, picked)
      toast.success(`已为 ${n} 个视频添加 ${picked.length} 个标签`)
      onOpenChange(false)
      onAdded?.()
    } catch (err) {
      toast.error(`添加失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>批量添加标签</DialogTitle>
          <DialogDescription>
            为选中的 {postIds.length} 个视频追加手动标签，已有标签不会被覆盖
          </DialogDescription>
        </DialogHeader>

        {picked.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {picked.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full bg-[#E8F0FE] px-2.5 py-1 text-xs text-[#0A84FF]"
              >
                {t}
                <button onClick={() => setPicked((prev) => prev.filter((x) => x !== t))}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add(input)
              }
            }}
            placeholder="输入标签名，回车添加"
            autoFocus
          />
          <Button variant="outline" disabled={!input.trim()} onClick={() => add(input)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {suggestions.length > 0 && (
          <div>
            <p className="text-xs text-[#A1A1A6] mb-2">
              {input.trim() ? '匹配的标签' : '标签库常用'}
            </p>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {suggestions.map((t) => (
                <button
                  key={t.tag}
                  onClick={() => add(t.tag)}
                  className={cn(
                    'rounded-full border border-[#E5E5E7] px-2.5 py-1 text-xs text-[#6E6E73]',
                    'hover:border-[#0A84FF] hover:text-[#0A84FF]'
                  )}
                >
                  {t.tag}
                  <span className="ml-1 text-[10px] text-[#C7C7CC] tabular-nums">{t.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={!picked.length || saving} onClick={submit}>
            {saving ? '添加中…' : `添加到 ${postIds.length} 个视频`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
