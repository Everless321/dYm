import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronLeft, Plus, Merge, Pencil, Search } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const SOURCE_COLOR: Record<string, { color: string; bg: string; label: string }> = {
  ai: { color: '#0A84FF', bg: '#E8F0FE', label: 'AI' },
  manual: { color: '#34C759', bg: '#E8F8EE', label: '手动' },
  both: { color: '#AF52DE', bg: '#F3E8FB', label: '混合' }
}

export default function TagLibraryPage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<TagLibraryStats>({
    totalTags: 0,
    categories: 0,
    usedTags: 0,
    unusedTags: 0
  })
  const [tags, setTags] = useState<TagFrequencyItem[]>([])
  const [categories, setCategories] = useState<TagCategoryItem[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeInto, setMergeInto] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [newValue, setNewValue] = useState('')

  const load = useCallback(async () => {
    const [s, t, c] = await Promise.all([
      window.api.tag.getLibraryStats(),
      window.api.tag.getTagsWithFrequency(),
      window.api.tag.getCategories()
    ])
    setStats(s)
    setTags(t)
    setCategories(c)
    setSelected(new Set())
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase()
    if (!kw) return tags
    return tags.filter((t) => t.tag.toLowerCase().includes(kw))
  }, [tags, search])

  const toggle = (tag: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const doRename = async () => {
    if (!renameTarget) return
    const v = renameValue.trim()
    if (!v || v === renameTarget) {
      setRenameTarget(null)
      return
    }
    const n = await window.api.tag.rename(renameTarget, v)
    toast.success(`已重命名，影响 ${n} 个视频`)
    setRenameTarget(null)
    load()
  }

  const doMerge = async () => {
    const names = Array.from(selected)
    const into = mergeInto.trim()
    if (names.length < 2 || !into) return
    const n = await window.api.tag.merge(names, into)
    toast.success(`已合并，影响 ${n} 个视频`)
    setMergeOpen(false)
    load()
  }

  const doNew = async () => {
    const v = newValue.trim()
    if (!v) return
    await window.api.tag.addCustomTag(v)
    toast.success(`已新建标签「${v}」`)
    setNewValue('')
    setNewOpen(false)
    load()
  }

  const selectedArr = Array.from(selected)

  return (
    <div className="flex flex-col h-full">
      <div className="h-16 flex items-center justify-between px-8 border-b border-[#E5E5E7] bg-white shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/tags')}
            className="flex items-center gap-1 text-sm text-[#6E6E73] hover:text-[#1D1D1F]"
          >
            <ChevronLeft className="h-4 w-4" />
            标签管理
          </button>
          <span className="text-[#D1D1D6]">/</span>
          <span className="font-medium text-[#1D1D1F]">标签库管理</span>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={selected.size < 2}
            onClick={() => {
              setMergeInto(selectedArr[0] || '')
              setMergeOpen(true)
            }}
          >
            <Merge className="h-4 w-4 mr-1" />
            合并 {selected.size > 0 ? `(${selected.size})` : ''}
          </Button>
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            新建标签
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 space-y-8">
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="标签总数" value={stats.totalTags} />
          <StatCard label="标签分类" value={stats.categories} color="#0A84FF" />
          <StatCard label="已使用" value={stats.usedTags} color="#34C759" />
          <StatCard label="未使用" value={stats.unusedTags} color="#FF9500" />
        </div>

        <div className="flex gap-6 items-start">
          {/* Categories */}
          <div className="w-64 shrink-0 rounded-xl border border-[#E5E5E7] bg-white p-5">
            <p className="text-xs font-medium text-[#A1A1A6] mb-3">分类分布</p>
            <div className="space-y-0.5">
              {categories.map((c) => (
                <div
                  key={c.category}
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-sm text-[#1D1D1F] hover:bg-[#F5F5F7] transition-colors"
                >
                  <span className="truncate">{c.category}</span>
                  <span className="text-xs text-[#A1A1A6] tabular-nums">{c.count}</span>
                </div>
              ))}
              {categories.length === 0 && <p className="text-xs text-[#C7C7CC]">暂无分类</p>}
            </div>
          </div>

          {/* Tags grid */}
          <div className="flex-1 rounded-xl border border-[#E5E5E7] bg-white flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E5E7]">
              <span className="text-sm font-medium text-[#1D1D1F]">
                全部标签（{filtered.length}）
              </span>
              <div className="relative w-56">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#A1A1A6]" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索标签"
                  className="pl-9 h-9"
                />
              </div>
            </div>
            <div className="p-5 flex flex-wrap gap-2.5 content-start">
              {filtered.map((t) => {
                const sc = SOURCE_COLOR[t.source]
                const isSel = selected.has(t.tag)
                return (
                  <div
                    key={t.tag}
                    onClick={() => toggle(t.tag)}
                    className={`group inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full text-xs cursor-pointer border-2 transition-all ${
                      isSel ? 'border-[#0A84FF]' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: sc.bg, color: sc.color }}
                  >
                    <span className="font-medium">{t.tag}</span>
                    <span className="opacity-60 tabular-nums">{t.count}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setRenameTarget(t.tag)
                        setRenameValue(t.tag)
                      }}
                      className="opacity-0 group-hover:opacity-100 hover:opacity-60"
                      title="重命名"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
              {filtered.length === 0 && (
                <p className="text-xs text-[#C7C7CC] py-8 w-full text-center">暂无标签</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Rename dialog */}
      <Dialog open={renameTarget !== null} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名标签</DialogTitle>
            <DialogDescription>
              将「{renameTarget}」重命名，所有视频中的该标签会同步更新
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doRename()}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              取消
            </Button>
            <Button onClick={doRename}>确认</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Merge dialog */}
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>合并标签</DialogTitle>
            <DialogDescription>将选中的 {selected.size} 个标签合并为一个</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-xs text-[#6E6E73]">合并目标</label>
            <div className="flex flex-wrap gap-2">
              {selectedArr.map((t) => (
                <button
                  key={t}
                  onClick={() => setMergeInto(t)}
                  className={`px-2.5 py-1 rounded-full text-xs border ${
                    mergeInto === t
                      ? 'border-[#0A84FF] bg-[#E8F0FE] text-[#0A84FF]'
                      : 'border-[#E5E5E7] text-[#6E6E73]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <Input
              value={mergeInto}
              onChange={(e) => setMergeInto(e.target.value)}
              placeholder="或输入新的目标标签名"
              className="mt-2"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setMergeOpen(false)}>
              取消
            </Button>
            <Button onClick={doMerge}>确认合并</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New tag dialog */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新建标签</DialogTitle>
            <DialogDescription>新建的标签会进入标签库，可在单视频编辑页采纳使用</DialogDescription>
          </DialogHeader>
          <Input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doNew()}
            placeholder="标签名"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              取消
            </Button>
            <Button onClick={doNew}>新建</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatCard({
  label,
  value,
  color = '#1D1D1F'
}: {
  label: string
  value: number
  color?: string
}) {
  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-black/[0.04] px-5 py-4">
      <div className="text-xs text-[#A1A1A6]">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1.5" style={{ color }}>
        {value.toLocaleString()}
      </div>
    </div>
  )
}
