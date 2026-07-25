import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Plus, Merge, Pencil, Trash2, Search, Film } from 'lucide-react'
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
import { PageHeader, Crumbs } from './components/PageHeader'
import { StatCard } from './components/StatCard'
import { TAG_SOURCE, TagSource, ACCENT } from './components/tokens'

type SourceFilter = 'all' | TagSource
type SortKey = 'count' | 'name'

const SOURCE_FILTERS: { key: SourceFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'ai', label: 'AI' },
  { key: 'manual', label: '手动' },
  { key: 'both', label: '混合' }
]

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
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [sort, setSort] = useState<SortKey>('count')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeInto, setMergeInto] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [newValue, setNewValue] = useState('')
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null)

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
    let list = tags
    if (kw) list = list.filter((t) => t.tag.toLowerCase().includes(kw))
    if (activeCategory === '未分类') list = list.filter((t) => t.categories.length === 0)
    else if (activeCategory) list = list.filter((t) => t.categories.includes(activeCategory))
    if (sourceFilter !== 'all') list = list.filter((t) => t.source === sourceFilter)
    return [...list].sort((a, b) =>
      sort === 'name' ? a.tag.localeCompare(b.tag, 'zh') : b.count - a.count
    )
  }, [tags, search, activeCategory, sourceFilter, sort])

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

  const doDelete = async () => {
    if (!deleteTargets?.length) return
    const n = await window.api.tag.deleteTag(deleteTargets)
    toast.success(`已删除 ${deleteTargets.length} 个标签，影响 ${n} 个视频`)
    setDeleteTargets(null)
    load()
  }

  const selectedArr = Array.from(selected)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        left={
          <Crumbs
            items={[
              { label: '标签管理', onClick: () => navigate('/tags') },
              { label: '标签库管理' }
            ]}
          />
        }
        right={
          <>
            <Button
              variant="outline"
              disabled={selected.size === 0}
              onClick={() => setDeleteTargets(selectedArr)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              删除 {selected.size > 0 ? `(${selected.size})` : ''}
            </Button>
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
          </>
        }
      />

      <div className="flex-1 overflow-y-auto p-8 space-y-8">
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="标签总数" value={stats.totalTags} />
          <StatCard label="标签分类" value={stats.categories} color={ACCENT.blue} />
          <StatCard label="已使用" value={stats.usedTags} color={ACCENT.green} />
          <StatCard label="未使用" value={stats.unusedTags} color={ACCENT.orange} />
        </div>

        <div className="flex gap-6 items-start">
          {/* Categories（可点击筛选） */}
          <div className="w-64 shrink-0 rounded-xl border border-[#E5E5E7] bg-white p-5">
            <p className="text-xs font-medium text-[#A1A1A6] mb-3">按分类筛选</p>
            <div className="space-y-0.5">
              <CategoryRow
                label="全部标签"
                count={tags.length}
                active={activeCategory === null}
                onClick={() => setActiveCategory(null)}
              />
              {categories.map((c) => (
                <CategoryRow
                  key={c.category}
                  label={c.category}
                  count={c.count}
                  active={activeCategory === c.category}
                  onClick={() =>
                    setActiveCategory((prev) => (prev === c.category ? null : c.category))
                  }
                />
              ))}
              {categories.length === 0 && <p className="text-xs text-[#C7C7CC]">暂无分类</p>}
            </div>
          </div>

          {/* Tags grid */}
          <div className="flex-1 rounded-xl border border-[#E5E5E7] bg-white flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E5E7] gap-3">
              <span className="text-sm font-medium text-[#1D1D1F] whitespace-nowrap">
                全部标签（{filtered.length}）
              </span>
              <div className="flex items-center gap-2.5">
                {/* Source segmented filter */}
                <div className="flex items-center rounded-lg bg-[#F2F2F4] p-0.5">
                  {SOURCE_FILTERS.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setSourceFilter(s.key)}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                        sourceFilter === s.key
                          ? 'bg-white text-[#1D1D1F] shadow-sm'
                          : 'text-[#6E6E73] hover:text-[#1D1D1F]'
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className="h-8 rounded-md border border-[#E5E5E7] bg-white px-2 text-xs text-[#1D1D1F] outline-none focus:border-[#0A84FF] cursor-pointer"
                >
                  <option value="count">按频次</option>
                  <option value="name">按名称</option>
                </select>
                <div className="relative w-48">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#A1A1A6]" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜索标签"
                    className="pl-9 h-9"
                  />
                </div>
              </div>
            </div>
            <div className="p-5 flex flex-wrap gap-2.5 content-start">
              {filtered.map((t) => {
                const sc = TAG_SOURCE[t.source]
                const isSel = selected.has(t.tag)
                return (
                  <div
                    key={t.tag}
                    onClick={() => toggle(t.tag)}
                    className={cn(
                      'group inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full text-xs cursor-pointer border-2 transition-all',
                      isSel ? 'border-[#0A84FF]' : 'border-transparent'
                    )}
                    style={{ backgroundColor: sc.bg, color: sc.color }}
                  >
                    <span className="font-medium">{t.tag}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        navigate(`/tags?tags=${encodeURIComponent(t.tag)}`)
                      }}
                      className="opacity-0 group-hover:opacity-100 hover:opacity-60"
                      title={`查看这 ${t.count} 个视频`}
                    >
                      <Film className="h-3 w-3" />
                    </button>
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
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteTargets([t.tag])
                      }}
                      className="opacity-0 group-hover:opacity-100 hover:opacity-60"
                      title="删除"
                    >
                      <Trash2 className="h-3 w-3" />
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
                  className={cn(
                    'px-2.5 py-1 rounded-full text-xs border',
                    mergeInto === t
                      ? 'border-[#0A84FF] bg-[#E8F0FE] text-[#0A84FF]'
                      : 'border-[#E5E5E7] text-[#6E6E73]'
                  )}
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

      {/* Delete confirm dialog */}
      <Dialog open={deleteTargets !== null} onOpenChange={(o) => !o && setDeleteTargets(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除标签</DialogTitle>
            <DialogDescription>
              将删除 {deleteTargets?.length || 0} 个标签，并从所有视频中移除，操作不可撤销
            </DialogDescription>
          </DialogHeader>
          {deleteTargets && deleteTargets.length > 0 && (
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {deleteTargets.map((t) => (
                <span
                  key={t}
                  className="px-2.5 py-1 rounded-full text-xs bg-[#F2F2F4] text-[#6E6E73]"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTargets(null)}>
              取消
            </Button>
            <Button className="bg-[#FF3B30] hover:bg-[#E5352B]" onClick={doDelete}>
              确认删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CategoryRow({
  label,
  count,
  active,
  onClick
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors',
        active ? 'bg-[#E8F0FE] text-[#0A84FF] font-medium' : 'text-[#1D1D1F] hover:bg-[#F5F5F7]'
      )}
    >
      <span className="truncate">{label}</span>
      <span className={cn('text-xs tabular-nums', active ? 'text-[#0A84FF]' : 'text-[#A1A1A6]')}>
        {count}
      </span>
    </button>
  )
}
