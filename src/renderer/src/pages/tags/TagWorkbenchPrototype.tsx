import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeftRight,
  FolderOpen,
  Images,
  LayoutGrid,
  List,
  Play,
  Plus,
  RotateCw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Video,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MediaViewer } from '@/components/media/MediaViewer'
import { AddTagsDialog } from './AddTagsDialog'
import { ClearTagsDialog } from './ClearTagsDialog'
import { ReanalyzeProgressDialog } from './ReanalyzeProgressDialog'
import { countActiveFilters, parseTagFilters, readList } from './filters'
import { getMergedTags, parseTags, toMediaSrc } from '@/lib/utils'

const pageSize = 60
const sortOptions: { key: TagPostSort; label: string }[] = [
  { key: 'downloaded', label: '下载时间↓' },
  { key: 'published', label: '发布时间' },
  { key: 'analyzed', label: '分析时间' },
  { key: 'level', label: '内容评级' }
]
const statusOptions: { key: TagStatusFilter; label: string; color: string }[] = [
  { key: 'all', label: '全部', color: '#0A84FF' },
  { key: 'untagged', label: '未标记', color: '#8E8E93' },
  { key: 'ai', label: '仅 AI', color: '#0A84FF' },
  { key: 'manual', label: '仅手动', color: '#8B5CF6' },
  { key: 'both', label: 'AI + 手动', color: '#22A06B' }
]

function durationLabel(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return ''
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function tagsOf(post: DbPost): { ai: string[]; manual: string[]; label: string; color: string } {
  const ai = parseTags(post.analysis_tags)
  const manual = parseTags(post.manual_tags)
  if (ai.length && manual.length) return { ai, manual, label: 'AI + 手动', color: '#22A06B' }
  if (ai.length) return { ai, manual, label: '仅 AI', color: '#0A84FF' }
  if (manual.length) return { ai, manual, label: '仅手动', color: '#8B5CF6' }
  return { ai, manual, label: '未标记', color: '#8E8E93' }
}

export default function TagWorkbenchPrototype(): React.JSX.Element {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const searchKey = params.toString()
  const filters = useMemo(() => parseTagFilters(params), [params])
  const status = (params.get('status') as TagStatusFilter | null) || 'all'
  const selectedTags = readList(params, 'tags')
  const categories = readList(params, 'cat')
  const scenes = readList(params, 'scene')
  const sort = (params.get('sort') as TagPostSort | null) || 'downloaded'
  const activeCount = countActiveFilters(filters)
  const [search, setSearch] = useState(params.get('q') || '')
  const [facetSearch, setFacetSearch] = useState('')
  const [tagSearch, setTagSearch] = useState('')
  const [sceneSearch, setSceneSearch] = useState('')
  const [stats, setStats] = useState<TagOverviewStats>({
    totalVideos: 0,
    tagged: 0,
    untagged: 0,
    tagKinds: 0
  })
  const [facets, setFacets] = useState<TagFilterFacets>({
    users: [],
    tags: [],
    categories: [],
    scenes: [],
    statusCounts: { untagged: 0, tagged: 0, ai: 0, manual: 0, both: 0 },
    total: 0
  })
  const [userStats, setUserStats] = useState<UserTagStats[]>([])
  const [posts, setPosts] = useState<DbPost[]>([])
  const [covers, setCovers] = useState<Map<number, string>>(new Map())
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [detailOpen, setDetailOpen] = useState(true)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [listMode, setListMode] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [addOpen, setAddOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [reanalyzeIds, setReanalyzeIds] = useState<number[] | null>(null)
  const [tagDraft, setTagDraft] = useState('')

  const patch = useCallback(
    (values: Record<string, string | undefined>) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          Object.entries(values).forEach(([key, value]) =>
            value ? next.set(key, value) : next.delete(key)
          )
          return next
        },
        { replace: true }
      )
    },
    [setParams]
  )

  const loadPosts = useCallback(
    async (nextPage: number, append = false): Promise<void> => {
      setLoading(true)
      try {
        const result = await window.api.tag.queryPosts(filters, nextPage, pageSize)
        setPosts((current) => (append ? [...current, ...result.posts] : result.posts))
        setTotal(result.total)
        setPage(nextPage)
        const pairs = await Promise.all(
          result.posts.map(async (post) => {
            try {
              const path = await window.api.post.getCoverPath(post.sec_uid, post.folder_name)
              return path ? ([post.id, path] as const) : null
            } catch {
              return null
            }
          })
        )
        setCovers((current) => {
          const next = new Map(current)
          pairs.forEach((pair) => pair && next.set(pair[0], pair[1]))
          return next
        })
      } catch (error) {
        toast.error(`加载视频失败：${(error as Error).message}`)
      } finally {
        setLoading(false)
      }
    },
    [filters]
  )

  useEffect(() => {
    setSearch(params.get('q') || '')
    setSelected(new Set())
    void loadPosts(1)
  }, [searchKey, loadPosts])

  useEffect(() => {
    void Promise.all([
      window.api.tag.getOverviewStats(),
      window.api.tag.getUserStats(),
      window.api.tag.getFilterFacets(filters)
    ])
      .then(([nextStats, nextUsers, nextFacets]) => {
        setStats(nextStats)
        setUserStats(nextUsers)
        setFacets(nextFacets)
      })
      .catch((error) => toast.error(`加载筛选失败：${(error as Error).message}`))
  }, [filters])

  useEffect(() => {
    if (search === (params.get('q') || '')) return
    const timer = window.setTimeout(() => patch({ q: search }), 300)
    return () => window.clearTimeout(timer)
  }, [search, params, patch])

  const detailPost = detailOpen ? posts.find((post) => post.id === detailId) || posts[0] : undefined
  useEffect(() => {
    let current = true
    setMediaUrl(null)
    if (!detailPost || detailPost.aweme_type === 68) return
    void window.api.post
      .getMediaFiles(detailPost.sec_uid, detailPost.folder_name, detailPost.aweme_type)
      .then((files) => {
        if (current && files?.type === 'video' && files.video) setMediaUrl(toMediaSrc(files.video))
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [detailPost?.id])

  const toggleList = (key: string, value: string): void => {
    const values = readList(params, key)
    patch({
      [key]: values.includes(value)
        ? values.filter((item) => item !== value).join(',')
        : [...values, value].join(',')
    })
  }
  const users = facets.users.filter((user) =>
    (user.nickname || user.sec_uid).toLowerCase().includes(facetSearch.toLowerCase())
  )
  const tags = facets.tags.filter((item) =>
    item.tag.toLowerCase().includes(tagSearch.toLowerCase())
  )
  const visibleScenes = facets.scenes.filter((item) =>
    item.scene.toLowerCase().includes(sceneSearch.toLowerCase())
  )
  const detailIndex = posts.findIndex((post) => post.id === detailPost?.id)
  const selectedIds = Array.from(selected)
  const clearFilters = (): void => {
    const next = new URLSearchParams()
    if (sort !== 'downloaded') next.set('sort', sort)
    setParams(next, { replace: true })
  }
  const setPostTagList = async (
    field: 'aiTags' | 'manualTags',
    values: string[]
  ): Promise<void> => {
    if (!detailPost) return
    try {
      await window.api.tag.setPostTags(detailPost.id, { [field]: values })
      setPosts((current) =>
        current.map((post) =>
          post.id === detailPost.id
            ? {
                ...post,
                [field === 'aiTags' ? 'analysis_tags' : 'manual_tags']: JSON.stringify(values)
              }
            : post
        )
      )
    } catch (error) {
      toast.error(`更新标签失败：${(error as Error).message}`)
    }
  }
  const addTag = (): void => {
    const value = tagDraft.trim()
    if (!value || !detailPost) return
    const manual = parseTags(detailPost.manual_tags)
    if (!manual.includes(value)) void setPostTagList('manualTags', [...manual, value])
    setTagDraft('')
  }
  const choosePost = (post: DbPost): void => {
    setDetailOpen(true)
    setDetailId(post.id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#F5F5F7]">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-white px-3">
        <div className="relative min-w-[180px] max-w-[260px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A1A1A6]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索标题、作者或标签"
            className="h-8 pl-8 pr-10 text-xs"
          />
          <kbd className="absolute right-2 top-2 text-[10px] text-[#A1A1A6]">⌘F</kbd>
        </div>
        <span className="ml-auto text-[10px] text-[#8E8E93]">排序</span>
        <div className="flex rounded-md bg-[#F2F2F4] p-0.5">
          {sortOptions.map((item) => (
            <button
              key={item.key}
              onClick={() => patch({ sort: item.key })}
              className={`rounded px-2 py-1 text-[10px] ${sort === item.key ? 'bg-white text-[#1D1D1F] shadow-sm' : 'text-[#6E6E73]'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex rounded border p-0.5">
          <button
            onClick={() => setListMode(false)}
            className={`rounded p-1 ${!listMode ? 'bg-[#E8F0FE] text-[#0A84FF]' : 'text-[#6E6E73]'}`}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            onClick={() => setListMode(true)}
            className={`rounded p-1 ${listMode ? 'bg-[#E8F0FE] text-[#0A84FF]' : 'text-[#6E6E73]'}`}
          >
            <List size={14} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
        {filtersOpen && (
          <aside className="w-[225px] shrink-0 space-y-4 overflow-y-auto rounded-lg border bg-white p-3">
            <div className="flex items-center justify-between">
              <b className="text-sm">筛选</b>
              <span className="flex items-center gap-2">
                <button onClick={clearFilters} className="text-xs text-[#0A84FF]">
                  重置 ({activeCount})
                </button>
                <button onClick={() => setFiltersOpen(false)} aria-label="收起筛选">
                  <ChevronsLeftRight size={15} />
                </button>
              </span>
            </div>
            <section>
              <p className="mb-1 text-xs font-medium text-[#6E6E73]">标注状态</p>
              {statusOptions.map((item) => (
                <button
                  key={item.key}
                  onClick={() => patch({ status: item.key === 'all' ? undefined : item.key })}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-xs ${status === item.key ? 'bg-[#E8F0FE] text-[#0A84FF]' : ''}`}
                >
                  <span className="flex items-center gap-2">
                    <i className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                    {item.label}
                  </span>
                  <span className="font-mono text-[10px] text-[#8E8E93]">
                    {item.key === 'all' ? facets.total : facets.statusCounts[item.key]}
                  </span>
                </button>
              ))}
            </section>
            <section className="space-y-2">
              <p className="text-xs font-medium text-[#6E6E73]">创作者</p>
              <FacetSearch value={facetSearch} onChange={setFacetSearch} placeholder="搜索创作者" />
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {users.slice(0, 25).map((user) => {
                  const avatar = userStats.find(
                    (item) => item.sec_uid === user.sec_uid
                  )?.avatar_path
                  return (
                    <button
                      key={user.sec_uid}
                      onClick={() =>
                        patch({
                          user: params.get('user') === user.sec_uid ? undefined : user.sec_uid
                        })
                      }
                      className="flex w-full items-center gap-2 text-left text-[10px]"
                    >
                      <span
                        className={`grid h-4 w-4 place-items-center rounded border ${params.get('user') === user.sec_uid ? 'border-[#0A84FF] bg-[#0A84FF] text-white' : ''}`}
                      >
                        {params.get('user') === user.sec_uid && <Check size={10} />}
                      </span>
                      {avatar ? (
                        <img
                          src={toMediaSrc(avatar)}
                          className="h-5 w-5 rounded-full object-cover"
                        />
                      ) : (
                        <i className="h-5 w-5 rounded-full bg-[#E5E5E7]" />
                      )}
                      <span className="flex-1 truncate">{user.nickname || user.sec_uid}</span>
                      <span className="text-[#8E8E93]">{user.count}</span>
                    </button>
                  )
                })}
              </div>
            </section>
            <section className="space-y-2">
              <p className="text-xs font-medium text-[#6E6E73]">标签</p>
              <div className="flex rounded bg-[#F2F2F4] p-0.5 text-[10px]">
                <button
                  onClick={() => patch({ tagMode: undefined })}
                  className={`flex-1 rounded py-1 ${params.get('tagMode') !== 'all' ? 'bg-white shadow-sm' : ''}`}
                >
                  任一标签
                </button>
                <button
                  onClick={() => patch({ tagMode: 'all' })}
                  className={`flex-1 rounded py-1 ${params.get('tagMode') === 'all' ? 'bg-white shadow-sm' : ''}`}
                >
                  同时满足
                </button>
              </div>
              <FacetSearch value={tagSearch} onChange={setTagSearch} placeholder="搜索标签" />
              <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                {tags.slice(0, 28).map((item) => (
                  <button
                    key={item.tag}
                    onClick={() => toggleList('tags', item.tag)}
                    className={`rounded-full border px-2 py-1 text-[10px] ${selectedTags.includes(item.tag) ? 'border-[#0A84FF] bg-[#E8F0FE] text-[#0A84FF]' : ''}`}
                  >
                    {selectedTags.includes(item.tag) && '✓ '}
                    {item.tag}
                  </button>
                ))}
              </div>
            </section>
            <FacetGroup
              title="分类"
              items={facets.categories.map((item) => ({ name: item.category, count: item.count }))}
              selected={categories}
              onToggle={(value) => toggleList('cat', value)}
            />
            <section className="space-y-2">
              <p className="text-xs font-medium text-[#6E6E73]">场景</p>
              <FacetSearch value={sceneSearch} onChange={setSceneSearch} placeholder="搜索场景" />
              <div className="flex flex-wrap gap-1">
                {visibleScenes.slice(0, 24).map((item) => (
                  <button
                    key={item.scene}
                    onClick={() => toggleList('scene', item.scene)}
                    className={`rounded-full border px-2 py-1 text-[10px] ${scenes.includes(item.scene) ? 'border-[#0A84FF] bg-[#E8F0FE] text-[#0A84FF]' : ''}`}
                  >
                    {scenes.includes(item.scene) && '✓ '}
                    {item.scene}
                  </button>
                ))}
              </div>
            </section>
            <section>
              <p className="mb-2 text-xs font-medium text-[#6E6E73]">内容评级</p>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={params.get('minLevel') || ''}
                  onChange={(event) => patch({ minLevel: event.target.value })}
                  placeholder="最低"
                  className="h-7 text-xs"
                />
                <span>–</span>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={params.get('maxLevel') || ''}
                  onChange={(event) => patch({ maxLevel: event.target.value })}
                  placeholder="最高"
                  className="h-7 text-xs"
                />
              </div>
            </section>
          </aside>
        )}
        <main className="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">
          <div className="grid shrink-0 grid-cols-4 gap-2">
            {[
              ['总视频数', stats.totalVideos],
              [
                '已标记',
                `${stats.totalVideos ? Math.round((stats.tagged / stats.totalVideos) * 100) : 0}%`
              ],
              [
                '未标记',
                `${stats.totalVideos ? Math.round((stats.untagged / stats.totalVideos) * 100) : 0}%`
              ],
              ['标签种类', stats.tagKinds]
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border bg-white px-3 py-2">
                <span className="text-[10px] text-[#8E8E93]">{label}</span>
                <p className="font-mono text-lg font-semibold">
                  {typeof value === 'number' ? value.toLocaleString() : value}
                </p>
              </div>
            ))}
          </div>
          <div className="flex min-h-8 shrink-0 items-center gap-2 overflow-x-auto">
            {!filtersOpen && (
              <button onClick={() => setFiltersOpen(true)}>
                <ChevronsLeftRight size={15} />
              </button>
            )}
            {selectMode ? (
              <Button
                size="sm"
                onClick={() => {
                  setSelectMode(false)
                  setSelected(new Set())
                }}
              >
                完成
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setSelectMode(true)}>
                <CheckSquare size={13} />
                多选
              </Button>
            )}
            <button
              onClick={() =>
                setSelected(
                  selected.size === posts.length ? new Set() : new Set(posts.map((post) => post.id))
                )
              }
              className="whitespace-nowrap text-xs"
            >
              □ 全选已加载 ({posts.length})
            </button>
            <span className="flex min-w-0 flex-1 gap-1 overflow-hidden">
              {selectedTags.map((tag) => (
                <Chip key={tag} label={tag} onRemove={() => toggleList('tags', tag)} />
              ))}
              {categories.map((item) => (
                <Chip key={item} label={`分类：${item}`} onRemove={() => toggleList('cat', item)} />
              ))}
              {scenes.map((item) => (
                <Chip
                  key={item}
                  label={`场景：${item}`}
                  onRemove={() => toggleList('scene', item)}
                />
              ))}
            </span>
            {activeCount > 0 && (
              <button onClick={clearFilters} className="text-xs text-[#0A84FF]">
                清除
              </button>
            )}
            <span className="whitespace-nowrap text-xs text-[#8E8E93]">
              {total.toLocaleString()} 个结果
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && posts.length === 0 ? (
              <Empty text="加载中…" />
            ) : posts.length === 0 ? (
              <Empty text="暂无符合条件的视频" />
            ) : listMode ? (
              <div className="space-y-1">
                {posts.map((post) => (
                  <button
                    key={post.id}
                    onClick={() =>
                      selectMode
                        ? setSelected((current) => new Set(current).add(post.id))
                        : choosePost(post)
                    }
                    className="flex w-full items-center gap-3 rounded-lg border bg-white p-2 text-left"
                  >
                    <Cover post={post} path={covers.get(post.id)} />
                    <span className="flex-1 truncate text-xs">
                      {post.caption || post.desc || '无标题'}
                    </span>
                    <span className="text-[10px] text-[#8E8E93]">{post.nickname}</span>
                    <span className="text-[10px]">{tagsOf(post).label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className={`grid gap-2 ${filtersOpen ? 'grid-cols-5' : 'grid-cols-6'}`}>
                {posts.map((post) => {
                  const tag = tagsOf(post)
                  const cover = covers.get(post.id)
                  return (
                    <button
                      key={post.id}
                      onClick={() =>
                        selectMode
                          ? setSelected((current) => {
                              const next = new Set(current)
                              next.has(post.id) ? next.delete(post.id) : next.add(post.id)
                              return next
                            })
                          : choosePost(post)
                      }
                      className={`min-w-0 rounded-lg border bg-white p-1.5 text-left ${detailPost?.id === post.id ? 'border-[#0A84FF] ring-1 ring-[#0A84FF]' : 'border-[#E5E5E7]'}`}
                    >
                      <div className="relative aspect-[3/4] overflow-hidden rounded bg-[#F2F2F4]">
                        {cover ? (
                          <img src={toMediaSrc(cover)} className="h-full w-full object-cover" />
                        ) : (
                          <div className="grid h-full place-items-center text-[#A1A1A6]">
                            {post.aweme_type === 68 ? <Images size={22} /> : <Video size={22} />}
                          </div>
                        )}
                        <span
                          className="absolute left-1 top-1 rounded-full bg-white/95 px-1.5 py-0.5 text-[9px]"
                          style={{ color: tag.color }}
                        >
                          {tag.label}
                        </span>
                        <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-white">
                          {selected.has(post.id) ? (
                            <Check size={12} className="text-[#0A84FF]" />
                          ) : selectMode ? (
                            <i className="h-2 w-2 rounded-full border" />
                          ) : null}
                        </span>
                        <span className="absolute bottom-1 right-1 rounded bg-black/65 px-1 text-[9px] text-white">
                          {post.aweme_type === 68 ? '图集' : durationLabel(post.duration) || '视频'}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 min-h-7 text-[10px] font-medium leading-3">
                        {post.caption || post.desc || '无标题'}
                      </p>
                      <p className="truncate text-[9px] text-[#8E8E93]">
                        @{post.nickname || post.sec_uid}
                      </p>
                      <div className="mt-1 flex gap-1 overflow-hidden">
                        {getMergedTags(post)
                          .slice(0, 2)
                          .map((item) => (
                            <span
                              key={item}
                              className="truncate rounded bg-[#F2F2F4] px-1 text-[8px]"
                            >
                              {item}
                            </span>
                          ))}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
            {posts.length < total && (
              <div className="flex justify-center py-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() => void loadPosts(page + 1, true)}
                >
                  加载更多 ({posts.length}/{total})
                </Button>
              </div>
            )}
          </div>
        </main>
        <aside className="flex w-[350px] shrink-0 flex-col overflow-hidden rounded-lg border bg-white">
          {detailPost ? (
            <>
              <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
                <b className="text-xs">详情</b>
                <span className="font-mono text-[10px] text-[#8E8E93]">
                  {Math.max(detailIndex + 1, 1)} / {total}
                </span>
                <span className="ml-auto" />
                <button onClick={() => setDetailId(posts[Math.max(detailIndex - 1, 0)]?.id)}>
                  <ChevronLeft size={15} />
                </button>
                <button
                  onClick={() =>
                    setDetailId(posts[Math.min(detailIndex + 1, posts.length - 1)]?.id)
                  }
                >
                  <ChevronRight size={15} />
                </button>
                <button onClick={() => setDetailOpen(false)}>
                  <X size={15} />
                </button>
              </div>
              <div className="h-[190px] shrink-0 bg-[#1D1D1F]">
                {detailPost.aweme_type !== 68 && mediaUrl ? (
                  <video
                    controls
                    preload="metadata"
                    src={mediaUrl}
                    poster={
                      covers.get(detailPost.id) ? toMediaSrc(covers.get(detailPost.id)!) : undefined
                    }
                    className="h-full w-full object-contain"
                  />
                ) : covers.get(detailPost.id) ? (
                  <img
                    src={toMediaSrc(covers.get(detailPost.id)!)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-white/50">
                    <Play size={28} />
                  </div>
                )}
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                <section>
                  <h2 className="text-sm font-semibold">
                    {detailPost.caption || detailPost.desc || '无标题'}
                  </h2>
                  <button
                    onClick={() =>
                      navigate(`/creators?user=${encodeURIComponent(detailPost.sec_uid)}`)
                    }
                    className="text-xs text-[#0A84FF]"
                  >
                    @{detailPost.nickname || detailPost.sec_uid}
                  </button>
                  <p className="mt-1 text-[10px] text-[#A1A1A6]">
                    {detailPost.width && detailPost.height
                      ? `${detailPost.width}×${detailPost.height} · `
                      : ''}
                    {durationLabel(detailPost.duration)}
                    {detailPost.downloaded_at
                      ? ` · ${new Date(detailPost.downloaded_at * 1000).toLocaleDateString('zh-CN')}`
                      : ''}
                  </p>
                </section>
                {detailPost.analysis_summary && (
                  <section>
                    <p className="mb-1 flex items-center gap-1 text-xs font-medium">
                      <Sparkles size={13} className="text-[#0A84FF]" />
                      AI 摘要
                      <span className="ml-auto text-[9px] text-[#A1A1A6]">
                        {detailPost.analyzed_at
                          ? new Date(detailPost.analyzed_at * 1000).toLocaleString('zh-CN')
                          : ''}
                      </span>
                    </p>
                    <p className="text-[11px] leading-4">{detailPost.analysis_summary}</p>
                  </section>
                )}
                <section className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[#8E8E93]">分类</span>
                    <span className="rounded border px-2 py-1 text-[10px]">
                      {detailPost.analysis_category || '未分类'}{' '}
                      <ChevronDown size={10} className="inline" />
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-[#8E8E93]">场景</span>
                    {detailPost.analysis_scene || '暂无'}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#8E8E93]">内容评级</span>
                    <span>
                      {detailPost.analysis_content_level || '—'} / 10 ·{' '}
                      {detailPost.analysis_content_level && detailPost.analysis_content_level >= 7
                        ? '较高'
                        : '一般'}
                    </span>
                  </div>
                </section>
                <section>
                  <div className="mb-2 flex justify-between text-xs">
                    <b>标签</b>
                    <span className="text-[#0A84FF]">
                      AI {tagsOf(detailPost).ai.length} · 手动 {tagsOf(detailPost).manual.length}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {tagsOf(detailPost).manual.map((item) => (
                      <span
                        key={item}
                        className="inline-flex items-center gap-1 rounded-full bg-[#F2F2F4] px-2 py-1 text-[10px]"
                      >
                        {item}
                        <button
                          onClick={() =>
                            void setPostTagList(
                              'manualTags',
                              tagsOf(detailPost).manual.filter((tag) => tag !== item)
                            )
                          }
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {tagsOf(detailPost).ai.map((item) => (
                      <span
                        key={item}
                        className="inline-flex items-center gap-1 rounded-full border border-[#B7D4FA] bg-[#F4F9FF] px-2 py-1 text-[10px] text-[#0A84FF]"
                      >
                        {item}
                        <button
                          onClick={() =>
                            void setPostTagList('manualTags', [...tagsOf(detailPost).manual, item])
                          }
                        >
                          <Check size={10} />
                        </button>
                        <button
                          onClick={() =>
                            void setPostTagList(
                              'aiTags',
                              tagsOf(detailPost).ai.filter((tag) => tag !== item)
                            )
                          }
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-1">
                    <Input
                      value={tagDraft}
                      onChange={(event) => setTagDraft(event.target.value)}
                      onKeyDown={(event) => event.key === 'Enter' && addTag()}
                      placeholder="添加标签…"
                      className="h-7 text-[10px]"
                    />
                    <button onClick={addTag}>
                      <Plus size={14} />
                    </button>
                  </div>
                </section>
              </div>
              <div className="flex shrink-0 gap-2 border-t p-2">
                <Button
                  size="sm"
                  className="flex-1 bg-[#1D1D1F] text-white"
                  onClick={() => setReanalyzeIds([detailPost.id])}
                >
                  <RotateCw size={13} />
                  重新分析
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() =>
                    window.api.post.openFolder(detailPost.sec_uid, detailPost.folder_name)
                  }
                >
                  <FolderOpen size={13} />
                  在文件夹中显示
                </Button>
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center text-xs text-[#A1A1A6]">
              选择一条视频查看详情
            </div>
          )}
        </aside>
      </div>
      {selectMode && selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-[#1D1D1F] px-4 py-2 text-white shadow-xl">
          <span className="text-xs">已选 {selected.size} 个</span>
          <button
            onClick={() => setAddOpen(true)}
            className="rounded bg-white/10 px-2 py-1 text-xs"
          >
            <Tag size={12} /> 添加标签
          </button>
          <button
            onClick={() => setClearOpen(true)}
            className="rounded bg-white/10 px-2 py-1 text-xs"
          >
            <Trash2 size={12} /> 批量清除
          </button>
          <button
            onClick={() => setReanalyzeIds(selectedIds)}
            className="rounded bg-white/10 px-2 py-1 text-xs"
          >
            <RotateCw size={12} /> 批量重标
          </button>
          <button onClick={() => setSelected(new Set())}>
            <X size={14} />
          </button>
        </div>
      )}
      <AddTagsDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        postIds={selectedIds}
        onAdded={() => void loadPosts(1)}
      />
      <ClearTagsDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        postIds={selectedIds}
        onCleared={() => void loadPosts(1)}
        onReanalyze={setReanalyzeIds}
      />
      <ReanalyzeProgressDialog
        open={reanalyzeIds !== null}
        onOpenChange={(open) => !open && setReanalyzeIds(null)}
        postIds={reanalyzeIds || []}
        onDone={() => void loadPosts(1)}
      />
      {detailPost && (
        <MediaViewer post={detailPost} open={viewerOpen} onOpenChange={setViewerOpen} />
      )}
    </div>
  )
}

function FacetSearch({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}): React.JSX.Element {
  return (
    <div className="relative">
      <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#A1A1A6]" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-7 pl-7 text-[10px]"
      />
    </div>
  )
}
function FacetGroup({
  title,
  items,
  selected,
  onToggle
}: {
  title: string
  items: { name: string; count: number }[]
  selected: string[]
  onToggle: (name: string) => void
}): React.JSX.Element {
  return (
    <section className="space-y-2">
      <p className="text-xs font-medium text-[#6E6E73]">{title}</p>
      <div className="flex flex-wrap gap-1">
        {items.slice(0, 24).map((item) => (
          <button
            key={item.name}
            onClick={() => onToggle(item.name)}
            className={`rounded-full border px-2 py-1 text-[10px] ${selected.includes(item.name) ? 'border-[#0A84FF] bg-[#E8F0FE] text-[#0A84FF]' : ''}`}
          >
            {selected.includes(item.name) && '✓ '}
            {item.name}
          </button>
        ))}
      </div>
    </section>
  )
}
function Chip({ label, onRemove }: { label: string; onRemove: () => void }): React.JSX.Element {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#E8F0FE] px-2 py-1 text-[10px] text-[#0A84FF]">
      {label}
      <button onClick={onRemove}>
        <X size={10} />
      </button>
    </span>
  )
}
function Cover({ post, path }: { post: DbPost; path?: string }): React.JSX.Element {
  return (
    <span className="grid h-12 w-9 shrink-0 place-items-center overflow-hidden rounded bg-[#F2F2F4]">
      {path ? (
        <img src={toMediaSrc(path)} className="h-full w-full object-cover" />
      ) : post.aweme_type === 68 ? (
        <Images size={16} />
      ) : (
        <Video size={16} />
      )}
    </span>
  )
}
function Empty({ text }: { text: string }): React.JSX.Element {
  return <div className="p-12 text-center text-sm text-[#8E8E93]">{text}</div>
}
