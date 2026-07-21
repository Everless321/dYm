import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Trash2, RotateCw, Play, Tag, Check, CheckSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getMergedTags } from '@/lib/utils'
import { ClearTagsDialog } from './ClearTagsDialog'
import { ReanalyzeProgressDialog } from './ReanalyzeProgressDialog'

const PAGE_SIZE = 60

export default function UserTagLibraryPage() {
  const { secUid = '' } = useParams()
  const navigate = useNavigate()
  const [nickname, setNickname] = useState('')
  const [posts, setPosts] = useState<DbPost[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [allTags, setAllTags] = useState<string[]>([])
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [covers, setCovers] = useState<Map<number, string>>(new Map())
  const [clearOpen, setClearOpen] = useState(false)
  const [reanalyzeIds, setReanalyzeIds] = useState<number[] | null>(null)

  const loadCovers = useCallback(async (items: DbPost[]) => {
    const map = new Map<number, string>()
    for (const p of items) {
      const c = await window.api.post.getCoverPath(p.sec_uid, p.folder_name)
      if (c) map.set(p.id, c)
    }
    setCovers((prev) => new Map([...prev, ...map]))
  }, [])

  const load = useCallback(
    async (pageNum: number, tag: string | null) => {
      const res = await window.api.tag.getPostsByUser(
        secUid,
        tag ? { tags: [tag] } : undefined,
        pageNum,
        PAGE_SIZE
      )
      setTotal(res.total)
      setPosts((prev) => (pageNum === 1 ? res.posts : [...prev, ...res.posts]))
      loadCovers(res.posts)
    },
    [secUid, loadCovers]
  )

  // 初始化：昵称 + 全部标签 + 第一页
  useEffect(() => {
    window.api.tag.getUserStats().then((list) => {
      setNickname(list.find((u) => u.sec_uid === secUid)?.nickname || '该用户')
    })
  }, [secUid])

  const refresh = useCallback(() => {
    setPage(1)
    setSelected(new Set())
    setSelectMode(false)
    load(1, activeTag)
    // 从首页数据聚合该用户标签
    window.api.tag.getPostsByUser(secUid, undefined, 1, 500).then((res) => {
      const set = new Set<string>()
      res.posts.forEach((p) => getMergedTags(p).forEach((t) => set.add(t)))
      setAllTags(Array.from(set).sort())
    })
  }, [load, activeTag, secUid])

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secUid, activeTag])

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exitSelect = () => {
    setSelectMode(false)
    setSelected(new Set())
  }

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === posts.length ? new Set() : new Set(posts.map((p) => p.id))
    )
  }

  const onCardClick = (p: DbPost) => {
    if (selectMode) toggleSelect(p.id)
    else navigate(`/tags/video/${p.id}`)
  }

  const selectedIds = Array.from(selected)
  const hasMore = posts.length < total

  return (
    <div className="flex flex-col h-full">
      {/* Header / breadcrumb */}
      <div className="h-16 flex items-center justify-between px-8 border-b border-[#E5E5E7] bg-white shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => navigate('/tags')}
            className="flex items-center gap-1 text-[#6E6E73] hover:text-[#1D1D1F]"
          >
            <ChevronLeft className="h-4 w-4" />
            标签管理
          </button>
          <span className="text-[#D1D1D6]">/</span>
          <span className="font-medium text-[#1D1D1F]">{nickname}</span>
          <span className="text-xs text-[#A1A1A6]">（{total} 个视频）</span>
        </div>
        {selectMode ? (
          <Button variant="ghost" size="sm" onClick={exitSelect}>
            完成
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setSelectMode(true)}>
            <CheckSquare className="h-4 w-4 mr-1.5" />
            选择
          </Button>
        )}
      </div>

      {/* Batch toolbar */}
      {selectMode && (
        <div className="flex items-center justify-between gap-4 px-8 py-3 bg-[#E8F0FE] border-b border-[#D1E3FB] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm text-[#0A84FF] font-medium whitespace-nowrap">
              已选 {selected.size} 个
            </span>
            <button
              onClick={toggleAll}
              className="text-xs text-[#0A84FF] hover:underline whitespace-nowrap"
            >
              {selected.size === posts.length && posts.length > 0 ? '取消全选' : '全选本页'}
            </button>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <Button
              size="sm"
              variant="outline"
              disabled={selected.size === 0}
              onClick={() => setClearOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              批量清除
            </Button>
            <Button
              size="sm"
              disabled={selected.size === 0}
              onClick={() => setReanalyzeIds(selectedIds)}
            >
              <RotateCw className="h-3.5 w-3.5 mr-1.5" />
              批量重标
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-8 space-y-6">
        {/* Tag filter chips */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2.5">
            <Chip active={activeTag === null} onClick={() => setActiveTag(null)}>
              全部
            </Chip>
            {allTags.map((t) => (
              <Chip key={t} active={activeTag === t} onClick={() => setActiveTag(t)}>
                {t}
              </Chip>
            ))}
          </div>
        )}

        {/* Grid */}
        <div className="grid grid-cols-4 gap-5">
          {posts.map((p) => {
            const tags = getMergedTags(p)
            const isSel = selected.has(p.id)
            const cover = covers.get(p.id)
            return (
              <div
                key={p.id}
                className={`rounded-xl border overflow-hidden bg-white transition-all hover:shadow-md ${
                  isSel ? 'border-[#0A84FF] ring-2 ring-[#0A84FF]/30' : 'border-[#E5E5E7]'
                }`}
              >
                <div
                  className="relative aspect-[3/4] bg-[#1D1D1F] cursor-pointer"
                  onClick={() => onCardClick(p)}
                >
                  {cover ? (
                    <img src={`local://file${cover}`} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Play className="h-8 w-8 text-white/40" />
                    </div>
                  )}
                  {selectMode && (
                    <>
                      {/* 选中蒙层 + 顶部渐变让勾选框清晰 */}
                      {!isSel && (
                        <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/30 to-transparent pointer-events-none" />
                      )}
                      {isSel && (
                        <div className="absolute inset-0 bg-[#0A84FF]/15 pointer-events-none" />
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleSelect(p.id)
                        }}
                        className={`absolute top-2.5 left-2.5 z-10 h-6 w-6 rounded-full flex items-center justify-center border transition-all ${
                          isSel
                            ? 'bg-[#0A84FF] border-[#0A84FF] shadow'
                            : 'bg-black/25 border-white/90 backdrop-blur-sm hover:bg-black/40'
                        }`}
                        aria-label="选择"
                      >
                        {isSel && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                      </button>
                    </>
                  )}
                </div>
                <div className="p-3.5 space-y-2">
                  <p className="text-xs text-[#1D1D1F] truncate leading-relaxed">
                    {p.desc || p.caption || '无描述'}
                  </p>
                  <div className="flex flex-wrap gap-1.5 min-h-[20px]">
                    {tags.slice(0, 3).map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-0.5 text-[10px] px-2 py-0.5 rounded-full bg-[#F2F2F4] text-[#6E6E73]"
                      >
                        <Tag className="h-2.5 w-2.5" />
                        {t}
                      </span>
                    ))}
                    {tags.length === 0 && (
                      <span className="text-[10px] text-[#C7C7CC]">未标记</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {posts.length === 0 && (
          <div className="py-16 text-center text-sm text-[#A1A1A6]">暂无视频</div>
        )}

        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              onClick={() => {
                const next = page + 1
                setPage(next)
                load(next, activeTag)
              }}
            >
              加载更多（{posts.length}/{total}）
            </Button>
          </div>
        )}
      </div>

      <ClearTagsDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        postIds={selectedIds}
        onCleared={refresh}
        onReanalyze={(ids) => setReanalyzeIds(ids)}
      />
      <ReanalyzeProgressDialog
        open={reanalyzeIds !== null}
        onOpenChange={(o) => !o && setReanalyzeIds(null)}
        postIds={reanalyzeIds || []}
        onDone={refresh}
      />
    </div>
  )
}

function Chip({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
        active
          ? 'bg-[#0A84FF] text-white'
          : 'bg-white border border-[#E5E5E7] text-[#6E6E73] hover:bg-[#F2F2F4]'
      }`}
    >
      {children}
    </button>
  )
}
