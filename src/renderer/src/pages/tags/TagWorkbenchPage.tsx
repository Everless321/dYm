import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Search, CheckSquare, Trash2, RotateCw, Plus, X, Check, Tag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn, getMergedTags, toMediaSrc } from '@/lib/utils'
import { MediaViewer } from '@/components/media/MediaViewer'
import { ClearTagsDialog } from './ClearTagsDialog'
import { ReanalyzeProgressDialog } from './ReanalyzeProgressDialog'
import { AddTagsDialog } from './AddTagsDialog'
import { PageHeader } from '@/components/layout/PageHeader'
import { FilterSection, FilterRow } from './components/FilterSection'
import { parseTagFilters, countActiveFilters, readList, FROM_LIST } from './filters'
import {
  readPanelPrefs,
  writePanelPrefs,
  type FilterSectionId,
  type PanelPrefs
} from './panel-prefs'

const PAGE_SIZE = 60
const LEVEL_MIN = 1
const LEVEL_MAX = 10
/** 单个筛选分组最多渲染的项数，超出靠搜索缩小范围 */
const LIST_LIMIT = 200

/**
 * 进详情页前暂存列表状态，返回时恢复。放在模块作用域，因为组件会被卸载。
 * key 为筛选条件（URL query），所以换筛选条件不会命中，不会用旧位置干扰新结果。
 * 由恢复 effect 在真正设好 scrollTop 后才删除，只生效一次。
 */
const listStateCache = new Map<string, { pages: number; scrollTop: number }>()

const STATUS_OPTIONS: { key: TagStatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'untagged', label: '未标记' },
  { key: 'ai', label: '仅 AI 标签' },
  { key: 'manual', label: '仅手动标签' },
  { key: 'both', label: 'AI + 手动' }
]

const SORT_OPTIONS: { key: TagPostSort; label: string }[] = [
  { key: 'downloaded', label: '下载时间' },
  { key: 'published', label: '发布时间' },
  { key: 'analyzed', label: '分析时间' },
  { key: 'level', label: '内容评级' }
]

export default function TagWorkbenchPage(): React.JSX.Element {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  // ── 筛选状态全部从 URL 读，保证可分享/可后退 ──
  const secUid = params.get('user') || undefined
  const status = (params.get('status') as TagStatusFilter | null) || 'all'
  const tags = readList(params, 'tags')
  const tagMode = params.get('tagMode') === 'all' ? 'all' : 'any'
  const categories = readList(params, 'cat')
  const scenes = readList(params, 'scene')
  const minLevel = params.get('minLevel') ? Number(params.get('minLevel')) : undefined
  const maxLevel = params.get('maxLevel') ? Number(params.get('maxLevel')) : undefined
  const keyword = params.get('q') || ''
  const sort = (params.get('sort') as TagPostSort | null) || 'downloaded'

  const [stats, setStats] = useState<TagOverviewStats>({
    totalVideos: 0,
    tagged: 0,
    untagged: 0,
    tagKinds: 0
  })
  const [users, setUsers] = useState<UserTagStats[]>([])
  const [facets, setFacets] = useState<TagFilterFacets>({
    users: [],
    tags: [],
    categories: [],
    scenes: [],
    statusCounts: { untagged: 0, tagged: 0, ai: 0, manual: 0, both: 0 },
    total: 0
  })

  const [posts, setPosts] = useState<DbPost[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [covers, setCovers] = useState<Map<number, string>>(new Map())
  // 结果区滚动容器；prevSearch 用于区分「换筛选条件」和「加载更多追加数据」
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevSearchRef = useRef('')
  // 列表请求序号。筛选切换很快时，慢的旧请求可能晚于新请求返回，用它丢弃过期结果
  const requestIdRef = useRef(0)

  // 筛选栏的顺序/折叠属于个人偏好，存本地；本页会因为进详情页而卸载，放组件 state 留不住
  const [panelPrefs, setPanelPrefs] = useState<PanelPrefs>(readPanelPrefs)

  const updatePanelPrefs = useCallback((next: PanelPrefs) => {
    setPanelPrefs(next)
    writePanelPrefs(next)
  }, [])

  const toggleSection = useCallback(
    (id: FilterSectionId) => {
      const collapsed = panelPrefs.collapsed.includes(id)
        ? panelPrefs.collapsed.filter((x) => x !== id)
        : [...panelPrefs.collapsed, id]
      updatePanelPrefs({ ...panelPrefs, collapsed })
    },
    [panelPrefs, updatePanelPrefs]
  )

  const moveSection = useCallback(
    (id: FilterSectionId, delta: -1 | 1) => {
      const from = panelPrefs.order.indexOf(id)
      const to = from + delta
      if (from < 0 || to < 0 || to >= panelPrefs.order.length) return
      const order = [...panelPrefs.order]
      order[from] = order[to]
      order[to] = id
      updatePanelPrefs({ ...panelPrefs, order })
    },
    [panelPrefs, updatePanelPrefs]
  )

  /** 每个分组都要的公共 props：展开状态 + 到顶/到底时禁用移动 */
  const sectionProps = (
    id: FilterSectionId
  ): {
    open: boolean
    onToggle: () => void
    onMoveUp?: () => void
    onMoveDown?: () => void
  } => {
    const index = panelPrefs.order.indexOf(id)
    return {
      open: !panelPrefs.collapsed.includes(id),
      onToggle: () => toggleSection(id),
      onMoveUp: index > 0 ? () => moveSection(id, -1) : undefined,
      onMoveDown: index < panelPrefs.order.length - 1 ? () => moveSection(id, 1) : undefined
    }
  }

  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [detailPostId, setDetailPostId] = useState<number | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [reanalyzeIds, setReanalyzeIds] = useState<number[] | null>(null)

  // 搜索框本地状态 + 防抖写回 URL，避免每个字符都触发查询
  const [searchDraft, setSearchDraft] = useState(keyword)
  const [tagSearch, setTagSearch] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [sceneSearch, setSceneSearch] = useState('')

  // 依赖 URL 字符串而非解析结果，保证引用稳定、不会每次渲染都触发重查
  const search = params.toString()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filters = useMemo<TagPostFilters>(() => parseTagFilters(params), [search])

  // ── URL 写入辅助 ──
  const patch = useCallback(
    (next: Record<string, string | undefined>) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(next)) {
            if (v === undefined || v === '') p.delete(k)
            else p.set(k, v)
          }
          return p
        },
        { replace: true }
      )
    },
    [setParams]
  )

  const toggleInList = useCallback(
    (key: string, value: string) => {
      const cur = readList(params, key)
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
      patch({ [key]: next.join(',') })
    },
    [params, patch]
  )

  const clearAll = (): void =>
    setParams(new URLSearchParams(sort === 'downloaded' ? {} : { sort }), { replace: true })

  const activeFilterCount = countActiveFilters(filters)

  // ── 数据加载 ──
  const loadCovers = useCallback(async (items: DbPost[]) => {
    // 并发取封面：逐个 await 时 60 条要串 60 次 IPC；单张失败不影响其他
    const entries = await Promise.allSettled(
      items.map(async (p) => {
        const c = await window.api.post.getCoverPath(p.sec_uid, p.folder_name)
        return c ? ([p.id, c] as const) : null
      })
    )
    setCovers((prev) => {
      const next = new Map(prev)
      for (const e of entries) {
        if (e.status === 'fulfilled' && e.value) next.set(e.value[0], e.value[1])
      }
      return next
    })
  }, [])

  // 成功后才推进 page，失败时列表和页码都保持原样
  const loadPage = useCallback(
    async (pageNum: number) => {
      const seq = ++requestIdRef.current
      setLoading(true)
      try {
        const res = await window.api.tag.queryPosts(filters, pageNum, PAGE_SIZE)
        if (seq !== requestIdRef.current) return
        setTotal(res.total)
        setPosts((prev) => (pageNum === 1 ? res.posts : [...prev, ...res.posts]))
        setPage(pageNum)
        loadCovers(res.posts)
      } catch (error) {
        if (seq !== requestIdRef.current) return
        toast.error(`加载视频失败: ${(error as Error).message}`)
      } finally {
        if (seq === requestIdRef.current) setLoading(false)
      }
    },
    [filters, loadCovers]
  )

  // 一次取回前 N 页，用于从详情页返回时重建列表（否则只剩第一页，滚动位置无处可去）
  const loadFirstPages = useCallback(
    async (pages: number) => {
      const seq = ++requestIdRef.current
      setLoading(true)
      try {
        const res = await window.api.tag.queryPosts(filters, 1, pages * PAGE_SIZE)
        if (seq !== requestIdRef.current) return
        setTotal(res.total)
        setPosts(res.posts)
        setPage(pages)
        loadCovers(res.posts)
      } catch (error) {
        if (seq !== requestIdRef.current) return
        toast.error(`加载视频失败: ${(error as Error).message}`)
      } finally {
        if (seq === requestIdRef.current) setLoading(false)
      }
    },
    [filters, loadCovers]
  )

  // 全库统计 + 用户标注进度（画像条要用），不随筛选变化
  const loadStats = useCallback(async () => {
    try {
      const [s, u] = await Promise.all([
        window.api.tag.getOverviewStats(),
        window.api.tag.getUserStats()
      ])
      setStats(s)
      setUsers(u)
    } catch (error) {
      toast.error(`加载统计失败: ${(error as Error).message}`)
    }
  }, [])

  // 分面计数随筛选变化重算
  const loadFacets = useCallback(async () => {
    try {
      setFacets(await window.api.tag.getFilterFacets(filters))
    } catch (error) {
      toast.error(`加载筛选项失败: ${(error as Error).message}`)
    }
  }, [filters])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  useEffect(() => {
    loadFacets()
  }, [loadFacets])

  // 筛选变化 → 重查。若是从详情页返回（缓存命中），连同已加载的页数一起取回，
  // 否则只剩第一页、滚动位置无处可去。这里只读不删，缓存留给下面的恢复 effect 消费 ——
  // StrictMode 下 effect 会双跑，读到即删会让第二次跑丢掉恢复目标。
  useEffect(() => {
    const pages = listStateCache.get(search)?.pages ?? 1
    setSelected(new Set())
    if (pages > 1) loadFirstPages(pages)
    else loadPage(1)
    // search 已经决定了 loadPage / loadFirstPages 的身份，无需重复列入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadPage, loadFirstPages])

  // posts 渲染后恢复滚动位置，成功后才消费缓存（幂等，重复执行无副作用）。
  // 卡片是固定宽高比容器，高度不依赖封面异步加载，所以此刻布局已稳定。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const cached = listStateCache.get(search)
    if (cached && posts.length > 0) {
      el.scrollTop = cached.scrollTop
      listStateCache.delete(search)
      prevSearchRef.current = search
      return
    }
    // 换了筛选条件（而非「加载更多」追加数据）时回到顶部
    if (prevSearchRef.current !== search) {
      el.scrollTop = 0
      prevSearchRef.current = search
    }
  }, [posts, search])

  // 点视频进详情页：先记下位置，返回时才恢复得回来
  const openVideo = useCallback(
    (postId: number) => {
      listStateCache.set(search, {
        pages: page,
        scrollTop: scrollRef.current?.scrollTop ?? 0
      })
      // 无筛选时补 FROM_LIST，好让详情页知道队列该是整个列表而不是「同作者」
      navigate(`/tags/video/${postId}?${search || FROM_LIST}`)
    },
    [search, page, navigate]
  )

  const refresh = useCallback(() => {
    setSelectMode(false)
    setSelected(new Set())
    loadPage(1)
    loadFacets()
    loadStats()
  }, [loadPage, loadFacets, loadStats])

  // 搜索防抖写回 URL
  const pushedKeyword = useRef(keyword)
  useEffect(() => {
    if (searchDraft === keyword) return
    const t = setTimeout(() => {
      pushedKeyword.current = searchDraft
      patch({ q: searchDraft })
    }, 300)
    return () => clearTimeout(t)
  }, [searchDraft, keyword, patch])

  // keyword 被外部改动（重置筛选 / 浏览器后退）时同步输入框，
  // 否则残留的草稿会在下一次防抖里把搜索词写回去
  useEffect(() => {
    if (keyword !== pushedKeyword.current) {
      pushedKeyword.current = keyword
      setSearchDraft(keyword)
    }
  }, [keyword])

  const toggleSelect = useCallback(
    (id: number): void =>
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    []
  )

  const handleCardClick = useCallback(
    (id: number): void => (selectMode ? toggleSelect(id) : setDetailPostId(id)),
    [selectMode, toggleSelect]
  )

  const selectedIds = Array.from(selected)
  const hasMore = posts.length < total
  const activeUser = secUid ? users.find((u) => u.sec_uid === secUid) : undefined
  const detailPost = posts.find((post) => post.id === detailPostId)

  useEffect(() => {
    if (!posts.length) {
      setDetailPostId(null)
      return
    }
    if (!posts.some((post) => post.id === detailPostId)) setDetailPostId(posts[0].id)
  }, [posts, detailPostId])

  const visibleUsers = useMemo(() => {
    const kw = userSearch.trim().toLowerCase()
    const list = kw
      ? facets.users.filter((u) => u.nickname?.toLowerCase().includes(kw))
      : facets.users
    // 已选中的用户可能不在当前分面结果里，补进来才能取消选择
    const picked =
      secUid && !list.some((u) => u.sec_uid === secUid)
        ? [{ sec_uid: secUid, nickname: activeUser?.nickname || secUid, count: 0 }]
        : []
    const all = [...picked, ...list]
    return { items: all.slice(0, LIST_LIMIT), matched: all.length }
  }, [facets.users, userSearch, secUid, activeUser?.nickname])

  const visibleTags = useMemo(() => {
    const kw = tagSearch.trim().toLowerCase()
    const list = kw ? facets.tags.filter((t) => t.tag.toLowerCase().includes(kw)) : facets.tags
    // 已选中的标签始终可见，否则取消不了
    const picked = tags
      .filter((t) => !list.some((x) => x.tag === t))
      .map((tag) => ({ tag, count: 0 }))
    const all = [...picked, ...list]
    return { items: all.slice(0, LIST_LIMIT), matched: all.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facets.tags, tagSearch, tags.join(',')])

  const visibleScenes = useMemo(() => {
    const kw = sceneSearch.trim().toLowerCase()
    const list = kw
      ? facets.scenes.filter((s) => s.scene.toLowerCase().includes(kw))
      : facets.scenes
    return { items: list.slice(0, LIST_LIMIT), matched: list.length }
  }, [facets.scenes, sceneSearch])

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="视频"
        meta={
          activeUser
            ? activeUser.nickname || activeUser.sec_uid
            : `${stats.totalVideos.toLocaleString()} 个视频 · 已标记 ${stats.tagged.toLocaleString()}`
        }
        actions={
          <>
            {selectMode ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectMode(false)
                  setSelected(new Set())
                }}
              >
                完成
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setSelectMode(true)}>
                <CheckSquare className="h-4 w-4 mr-1.5" />
                多选
              </Button>
            )}
          </>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col gap-3 p-5 pb-0 overflow-hidden">
        <div className="flex-1 min-h-0 flex gap-3">
          {/* ── 左侧筛选栏 ── */}
          <aside className="w-[208px] shrink-0 rounded-lg border border-[#E5E5E7] bg-white flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#F0F0F2] shrink-0">
              <span className="text-sm font-medium text-[#1D1D1F]">筛选</span>
              {activeFilterCount > 0 && (
                <button onClick={clearAll} className="text-xs text-[#0A84FF] hover:underline">
                  重置（{activeFilterCount}）
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-3">
              {(() => {
                // 六个分组先各自建好，再按用户保存的顺序渲染
                const nodes: Record<FilterSectionId, React.JSX.Element> = {
                  status: (
                    <FilterSection
                      {...sectionProps('status')}
                      title="标注状态"
                      activeCount={status !== 'all' ? 1 : 0}
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <FilterRow
                          key={s.key}
                          label={s.label}
                          count={s.key === 'all' ? facets.total : facets.statusCounts[s.key]}
                          active={status === s.key}
                          onClick={() => patch({ status: s.key === 'all' ? undefined : s.key })}
                        />
                      ))}
                    </FilterSection>
                  ),
                  user: (
                    <FilterSection
                      {...sectionProps('user')}
                      title="用户"
                      activeCount={secUid ? 1 : 0}
                      onClear={() => patch({ user: undefined })}
                      search={
                        <FilterSearch
                          value={userSearch}
                          onChange={setUserSearch}
                          placeholder={`搜索用户（共 ${facets.users.length}）`}
                        />
                      }
                      footer={
                        <TruncatedHint
                          shown={visibleUsers.items.length}
                          matched={visibleUsers.matched}
                        />
                      }
                    >
                      {visibleUsers.items.map((u) => (
                        <FilterRow
                          key={u.sec_uid}
                          label={u.nickname || u.sec_uid}
                          count={u.count}
                          active={secUid === u.sec_uid}
                          onClick={() =>
                            patch({ user: secUid === u.sec_uid ? undefined : u.sec_uid })
                          }
                        />
                      ))}
                      {visibleUsers.items.length === 0 && (
                        <p className="px-2 py-1 text-xs text-[#C7C7CC]">没有匹配的用户</p>
                      )}
                    </FilterSection>
                  ),
                  tag: (
                    <FilterSection
                      {...sectionProps('tag')}
                      title="标签"
                      activeCount={tags.length}
                      onClear={() => patch({ tags: undefined })}
                      search={
                        <>
                          {tags.length > 1 && (
                            <div className="flex items-center rounded-lg bg-[#F2F2F4] p-0.5 mb-1.5">
                              {(['any', 'all'] as const).map((m) => (
                                <button
                                  key={m}
                                  onClick={() => patch({ tagMode: m === 'any' ? undefined : m })}
                                  className={cn(
                                    'flex-1 rounded-md py-1 text-[11px] font-medium transition-colors',
                                    tagMode === m
                                      ? 'bg-white text-[#1D1D1F] shadow-sm'
                                      : 'text-[#6E6E73] hover:text-[#1D1D1F]'
                                  )}
                                >
                                  {m === 'any' ? '任一标签' : '同时满足'}
                                </button>
                              ))}
                            </div>
                          )}
                          <FilterSearch
                            value={tagSearch}
                            onChange={setTagSearch}
                            placeholder={`搜索标签（共 ${facets.tags.length}）`}
                          />
                        </>
                      }
                      footer={
                        <TruncatedHint
                          shown={visibleTags.items.length}
                          matched={visibleTags.matched}
                        />
                      }
                    >
                      {visibleTags.items.map((t) => (
                        <FilterRow
                          key={t.tag}
                          label={t.tag}
                          count={t.count}
                          active={tags.includes(t.tag)}
                          onClick={() => toggleInList('tags', t.tag)}
                        />
                      ))}
                      {visibleTags.items.length === 0 && (
                        <p className="px-2 py-1 text-xs text-[#C7C7CC]">
                          {tagSearch.trim() ? '没有匹配的标签' : '当前条件下没有可用标签'}
                        </p>
                      )}
                    </FilterSection>
                  ),
                  category: (
                    <FilterSection
                      {...sectionProps('category')}
                      title="分类"
                      activeCount={categories.length}
                      onClear={() => patch({ cat: undefined })}
                    >
                      {facets.categories.map((c) => (
                        <FilterRow
                          key={c.category}
                          label={c.category}
                          count={c.count}
                          active={categories.includes(c.category)}
                          onClick={() => toggleInList('cat', c.category)}
                        />
                      ))}
                      {facets.categories.length === 0 && (
                        <p className="px-2 text-xs text-[#C7C7CC]">暂无分类</p>
                      )}
                    </FilterSection>
                  ),
                  scene: (
                    <FilterSection
                      {...sectionProps('scene')}
                      title="场景"
                      activeCount={scenes.length}
                      onClear={() => patch({ scene: undefined })}
                      search={
                        facets.scenes.length > 8 ? (
                          <FilterSearch
                            value={sceneSearch}
                            onChange={setSceneSearch}
                            placeholder={`搜索场景（共 ${facets.scenes.length}）`}
                          />
                        ) : undefined
                      }
                      footer={
                        <TruncatedHint
                          shown={visibleScenes.items.length}
                          matched={visibleScenes.matched}
                        />
                      }
                    >
                      {visibleScenes.items.map((s) => (
                        <FilterRow
                          key={s.scene}
                          label={s.scene}
                          count={s.count}
                          active={scenes.includes(s.scene)}
                          onClick={() => toggleInList('scene', s.scene)}
                        />
                      ))}
                      {visibleScenes.items.length === 0 && (
                        <p className="px-2 py-1 text-xs text-[#C7C7CC]">
                          {sceneSearch.trim() ? '没有匹配的场景' : '暂无场景数据'}
                        </p>
                      )}
                    </FilterSection>
                  ),
                  level: (
                    <FilterSection
                      {...sectionProps('level')}
                      title="内容评级"
                      activeCount={minLevel !== undefined || maxLevel !== undefined ? 1 : 0}
                      onClear={() => patch({ minLevel: undefined, maxLevel: undefined })}
                    >
                      <div className="flex items-center gap-1.5 px-1">
                        <Input
                          type="number"
                          min={LEVEL_MIN}
                          max={LEVEL_MAX}
                          value={minLevel ?? ''}
                          onChange={(e) => patch({ minLevel: e.target.value })}
                          placeholder={String(LEVEL_MIN)}
                          className="h-7 text-xs"
                        />
                        <span className="text-xs text-[#A1A1A6]">—</span>
                        <Input
                          type="number"
                          min={LEVEL_MIN}
                          max={LEVEL_MAX}
                          value={maxLevel ?? ''}
                          onChange={(e) => patch({ maxLevel: e.target.value })}
                          placeholder={String(LEVEL_MAX)}
                          className="h-7 text-xs"
                        />
                      </div>
                    </FilterSection>
                  )
                }
                return panelPrefs.order.map((id) => <Fragment key={id}>{nodes[id]}</Fragment>)
              })()}
            </div>
          </aside>

          {/* ── 右侧结果区 ── */}
          <div className="flex-1 min-w-0 flex gap-3 overflow-hidden">
            <div className="flex-[1.35] min-w-0 rounded-lg border border-[#E5E5E7] bg-white flex flex-col overflow-hidden">
              <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-[#F0F0F2] shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-[#1D1D1F] whitespace-nowrap tabular-nums">
                    {total} 个视频
                  </span>
                  {activeFilterCount > 0 && (
                    <span className="text-xs text-[#A1A1A6] whitespace-nowrap">
                      · {activeFilterCount} 个筛选条件
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <select
                    value={sort}
                    onChange={(e) => patch({ sort: e.target.value })}
                    className="h-8 rounded-md border border-[#E5E5E7] bg-white px-2 text-xs text-[#1D1D1F] outline-none focus:border-[#0A84FF] cursor-pointer"
                  >
                    {SORT_OPTIONS.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <div className="relative w-56">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#A1A1A6]" />
                    <Input
                      value={searchDraft}
                      onChange={(e) => setSearchDraft(e.target.value)}
                      placeholder="搜索标题 / 描述 / 标签"
                      className="pl-9 h-8"
                    />
                  </div>
                </div>
              </div>

              {/* 已选条件 chips */}
              {(tags.length > 0 || categories.length > 0 || scenes.length > 0) && (
                <div className="flex flex-wrap gap-1.5 px-5 py-2.5 border-b border-[#F0F0F2] shrink-0">
                  {tags.map((t) => (
                    <FilterChip key={`t-${t}`} onRemove={() => toggleInList('tags', t)}>
                      {t}
                    </FilterChip>
                  ))}
                  {categories.map((c) => (
                    <FilterChip key={`c-${c}`} onRemove={() => toggleInList('cat', c)}>
                      分类：{c}
                    </FilterChip>
                  ))}
                  {scenes.map((s) => (
                    <FilterChip key={`s-${s}`} onRemove={() => toggleInList('scene', s)}>
                      场景：{s}
                    </FilterChip>
                  ))}
                </div>
              )}

              <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
                <div className="divide-y divide-[#F0F0F2]">
                  {posts.map((post) => {
                    const mergedTags = getMergedTags(post).slice(0, 3)
                    const active = detailPostId === post.id
                    return (
                      <div
                        key={post.id}
                        onClick={() => handleCardClick(post.id)}
                        className={cn(
                          'flex items-center gap-3 rounded-md px-2 py-2.5 cursor-pointer transition-colors',
                          active ? 'bg-[#F0F6FF]' : 'hover:bg-[#F8F9FB]'
                        )}
                      >
                        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-[#F2F2F4]">
                          {covers.get(post.id) && (
                            <img
                              src={toMediaSrc(covers.get(post.id)!)}
                              className="h-full w-full object-cover"
                              alt=""
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[#1D1D1F]">
                            {post.caption || post.desc || '无标题'}
                          </p>
                          <p className="mt-1 truncate text-xs text-[#8A8A8E]">
                            {post.nickname || post.sec_uid}
                            {post.create_time
                              ? ` · ${new Date(Number(post.create_time) * 1000).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`
                              : ''}
                          </p>
                          <div className="mt-1 flex gap-1 overflow-hidden">
                            {mergedTags.map((tag) => (
                              <span
                                key={tag}
                                className="max-w-24 truncate rounded bg-[#F2F2F4] px-1.5 py-0.5 text-[10px] text-[#6E6E73]"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                        {selectMode ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleSelect(post.id)
                            }}
                            className={cn(
                              'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                              selected.has(post.id)
                                ? 'border-[#0A84FF] bg-[#0A84FF] text-white'
                                : 'border-[#C7C7CC] bg-white text-transparent'
                            )}
                            aria-label={selected.has(post.id) ? '取消选择' : '选择视频'}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <span className="text-xs text-[#A1A1A6]">
                            {post.analysis_summary ? '已分析' : '待分析'}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>

                {posts.length === 0 && !loading && (
                  <div className="py-20 text-center space-y-3">
                    <p className="text-sm text-[#A1A1A6]">
                      {activeFilterCount > 0 ? '没有符合条件的视频' : '暂无视频'}
                    </p>
                    {activeFilterCount > 0 && (
                      <Button variant="outline" size="sm" onClick={clearAll}>
                        清除筛选条件
                      </Button>
                    )}
                  </div>
                )}

                {hasMore && (
                  <div className="flex justify-center pt-5">
                    <Button variant="outline" disabled={loading} onClick={() => loadPage(page + 1)}>
                      {loading ? '加载中…' : `加载更多（${posts.length}/${total}）`}
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <aside className="w-[300px] shrink-0 rounded-lg border border-[#E5E5E7] bg-white flex flex-col overflow-hidden">
              {detailPost ? (
                <>
                  <div className="relative aspect-[4/5] max-h-[320px] bg-[#1D1D1F]">
                    {covers.get(detailPost.id) && (
                      <img
                        src={toMediaSrc(covers.get(detailPost.id)!)}
                        className="h-full w-full object-cover"
                        alt=""
                      />
                    )}
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                    <div>
                      <p className="text-sm font-semibold text-[#1D1D1F]">
                        {detailPost.caption || detailPost.desc || '无标题'}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(`/creators?user=${encodeURIComponent(detailPost.sec_uid)}`)
                        }
                        className="mt-1 text-xs text-[#0A84FF] hover:underline"
                      >
                        {detailPost.nickname || detailPost.sec_uid}
                      </button>
                    </div>
                    <div className="space-y-1 rounded-md bg-[#F7F7F9] p-3">
                      <p className="text-[11px] font-medium text-[#8A8A8E]">作品描述</p>
                      <p className="line-clamp-4 text-xs leading-relaxed text-[#45454A]">
                        {detailPost.desc || detailPost.caption || '暂无描述'}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[11px] font-medium text-[#8A8A8E]">标签</p>
                      <div className="flex flex-wrap gap-1.5">
                        {getMergedTags(detailPost).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-[#EAF3FF] px-2 py-1 text-[11px] text-[#2675C7]"
                          >
                            {tag}
                          </span>
                        ))}
                        {!getMergedTags(detailPost).length && (
                          <span className="text-xs text-[#A1A1A6]">暂无标签</span>
                        )}
                      </div>
                    </div>
                    {detailPost.analysis_summary && (
                      <div className="space-y-1">
                        <p className="text-[11px] font-medium text-[#8A8A8E]">AI 摘要</p>
                        <p className="line-clamp-4 text-xs leading-relaxed text-[#45454A]">
                          {detailPost.analysis_summary}
                        </p>
                      </div>
                    )}
                    <div className="mt-auto grid grid-cols-2 gap-2">
                      <Button variant="outline" size="sm" onClick={() => setViewerOpen(true)}>
                        播放
                      </Button>
                      <Button size="sm" onClick={() => openVideo(detailPost.id)}>
                        <Tag className="mr-1.5 h-3.5 w-3.5" />
                        标注
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-[#A1A1A6]">
                  选择一条视频查看详情
                </div>
              )}
            </aside>
          </div>
        </div>
        {selectMode && selected.size > 0 && (
          <div className="mb-3 flex shrink-0 items-center gap-3 rounded-lg border border-[#D9E8FA] bg-white px-4 py-3 shadow-sm">
            <span className="text-sm font-medium text-[#1D1D1F]">
              已选择 {selected.size} 个视频
            </span>
            <button
              type="button"
              onClick={() =>
                setSelected((prev) =>
                  prev.size === posts.length ? new Set() : new Set(posts.map((post) => post.id))
                )
              }
              className="text-xs text-[#0A84FF] hover:underline"
            >
              {selected.size === posts.length && posts.length > 0 ? '取消全选' : '全选已加载'}
            </button>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                添加标签
              </Button>
              <Button size="sm" variant="outline" onClick={() => setClearOpen(true)}>
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                批量清除
              </Button>
              <Button size="sm" variant="outline" onClick={() => setReanalyzeIds(selectedIds)}>
                <RotateCw className="mr-1 h-3.5 w-3.5" />
                批量重分析
              </Button>
            </div>
          </div>
        )}
      </div>

      <AddTagsDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        postIds={selectedIds}
        onAdded={refresh}
      />
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
      {detailPost && (
        <MediaViewer post={detailPost} open={viewerOpen} onOpenChange={setViewerOpen} />
      )}
    </div>
  )
}

/** 筛选分组内的搜索框（上千项时靠它缩小范围） */
function FilterSearch({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}): React.JSX.Element {
  return (
    <div className="relative">
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#A1A1A6]" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 pl-7 text-xs"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[#A1A1A6] hover:text-[#1D1D1F]"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

/** 列表被 LIST_LIMIT 截断时明确告知，避免以为「就这么多」 */
function TruncatedHint({
  shown,
  matched
}: {
  shown: number
  matched: number
}): React.JSX.Element | null {
  if (matched <= shown) return null
  return (
    <p className="px-2 pt-1 text-[10px] text-[#A1A1A6]">
      显示前 {shown} 项，共 {matched} 项 · 用搜索缩小范围
    </p>
  )
}

function FilterChip({
  children,
  onRemove
}: {
  children: React.ReactNode
  onRemove: () => void
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F0FE] px-2.5 py-1 text-xs text-[#0A84FF]">
      {children}
      <button onClick={onRemove} className="hover:opacity-60">
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
