import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  ChevronDown,
  ChevronUp,
  Ellipsis,
  EyeOff,
  FolderOpen,
  Images,
  Link as LinkIcon,
  Play,
  RotateCw,
  Search,
  SquarePen,
  Tag,
  Tags,
  UserRound,
  Users,
  Video,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { MediaViewer } from '@/components/media/MediaViewer'
import { VideoDownloadDialog } from '@/components/media/VideoDownloadDialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { getInitialSort } from '@/lib/post-sort'
import { getMergedTags, toMediaSrc } from '@/lib/utils'

const pageSize = 50
const sortOptions: { field: PostSortField; label: string }[] = [
  { field: 'create_time', label: '发布时间' },
  { field: 'downloaded_at', label: '下载时间' },
  { field: 'analyzed_at', label: '分析时间' },
  { field: 'analysis_content_level', label: '内容评级' }
]

export default function BrowsePrototype(): React.JSX.Element {
  const navigate = useNavigate()
  const [posts, setPosts] = useState<DbPost[]>([])
  const [authors, setAuthors] = useState<PostAuthor[]>([])
  const [creatorRecords, setCreatorRecords] = useState<DbUser[]>([])
  const [tags, setTags] = useState<TagFrequencyItem[]>([])
  const [covers, setCovers] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<DbPost | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [author, setAuthor] = useState('')
  const [authorOpen, setAuthorOpen] = useState(false)
  const [authorSearch, setAuthorSearch] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagSearch, setTagSearch] = useState('')
  const [showAllTags, setShowAllTags] = useState(false)
  const [levels, setLevels] = useState<[number, number]>([0, 10])
  const [analyzedOnly, setAnalyzedOnly] = useState(false)
  const [sort, setSort] = useState<PostSortConfig>(() => getInitialSort('home_post_sort'))
  const [webOrigin, setWebOrigin] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const gridRef = useRef<HTMLDivElement>(null)
  const seqRef = useRef(0)
  const authorWrapRef = useRef<HTMLDivElement>(null)

  const filters = useMemo<PostFilters>(
    () => ({
      secUid: author || undefined,
      tags: selectedTags.length ? selectedTags : undefined,
      minContentLevel: levels[0] > 0 ? levels[0] : undefined,
      maxContentLevel: levels[1] < 10 ? levels[1] : undefined,
      analyzedOnly: analyzedOnly || undefined,
      keyword: debouncedSearch || undefined
    }),
    [author, selectedTags, levels, analyzedOnly, debouncedSearch]
  )

  const loadPosts = useCallback(
    async (nextPage: number, append = false): Promise<void> => {
      const seq = ++seqRef.current
      append ? setLoadingMore(true) : setLoading(true)
      try {
        const result = await window.api.post.getAll(nextPage, pageSize, filters, sort)
        if (seq !== seqRef.current) return
        setPosts((current) => (append ? [...current, ...result.posts] : result.posts))
        setAuthors(result.authors)
        setTotal(result.total)
        setHasMore(result.posts.length === pageSize)
        setPage(nextPage)
        const paths = await Promise.all(
          result.posts.map(async (post) => {
            try {
              const path = await window.api.post.getCoverPath(post.sec_uid, post.folder_name)
              return path ? ([post.aweme_id, toMediaSrc(path)] as const) : null
            } catch {
              return null
            }
          })
        )
        setCovers((current) => {
          const next = { ...current }
          paths.forEach((item) => {
            if (item) next[item[0]] = item[1]
          })
          return next
        })
      } catch (error) {
        toast.error(`加载视频失败：${(error as Error).message}`)
      } finally {
        if (seq === seqRef.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [filters, sort]
  )

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])
  useEffect(() => {
    if (!authorOpen) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!authorWrapRef.current?.contains(event.target as Node)) setAuthorOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAuthorOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [authorOpen])
  useEffect(() => {
    localStorage.setItem('home_post_sort', JSON.stringify(sort))
    setPosts([])
    setPage(1)
    setHasMore(true)
    void loadPosts(1)
  }, [loadPosts, sort])
  useEffect(() => {
    void Promise.all([
      window.api.tag.getTagsWithFrequency(),
      window.api.system.getWebServerInfo(),
      window.api.user.getAll()
    ])
      .then(([frequencies, server, users]) => {
        setTags(frequencies)
        setWebOrigin(server.started ? server.origin : '')
        setCreatorRecords(users)
      })
      .catch((error) => console.error('[Browse] 加载标签或网页端状态失败', error))
  }, [])
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore)
          void loadPosts(page + 1, true)
      },
      { threshold: 0.1 }
    )
    const element = gridRef.current
    if (element) observer.observe(element)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, page, loadPosts])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'Space' && !viewerOpen && selected) {
        event.preventDefault()
        setViewerOpen(true)
      }
      if (event.key === 'ArrowRight' && viewerOpen && selected) {
        const index = posts.findIndex((post) => post.id === selected.id)
        if (index >= 0 && posts[index + 1]) setSelected(posts[index + 1])
      }
      // 右键 / 悬停选中卡片后，菜单里标出的快捷键直接生效
      if (!viewerOpen && selected) {
        const key = event.key.toLowerCase()
        if (key === 't' || (key === 'e' && event.metaKey)) {
          event.preventDefault()
          navigate(`/tags/video/${selected.id}`)
        } else if (key === 'a' && event.metaKey) {
          event.preventDefault()
          navigate(`/creators?user=${encodeURIComponent(selected.sec_uid)}`)
        } else if (key === 'r' && event.metaKey) {
          event.preventDefault()
          void window.api.post.openFolder(selected.sec_uid, selected.folder_name)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [posts, selected, viewerOpen, navigate])

  const clearFilters = (): void => {
    setSearch('')
    setAuthor('')
    setSelectedTags([])
    setLevels([0, 10])
    setAnalyzedOnly(false)
  }
  const toggleTag = (tag: string): void => {
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    )
  }
  const openPost = (post: DbPost): void => {
    setSelected(post)
    setViewerOpen(true)
  }
  const filteredAuthors = authors.filter((item) =>
    item.nickname.toLowerCase().includes(authorSearch.toLowerCase())
  )
  const filteredTags = tags.filter((item) =>
    item.tag.toLowerCase().includes(tagSearch.toLowerCase())
  )
  const visibleTags = showAllTags || tagSearch ? filteredTags : filteredTags.slice(0, 12)
  const hiddenCreators = creatorRecords.filter((user) => !user.show_in_home)
  const activeFilter = Boolean(
    search.trim() ||
    author ||
    selectedTags.length ||
    levels[0] > 0 ||
    levels[1] < 10 ||
    analyzedOnly
  )
  const authorName = author
    ? (authors.find((item) => item.sec_uid === author)?.nickname ?? '作者')
    : '全部作者'

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg)]">
      {/* Header：标题行 + 筛选行 + 标签行 */}
      <div className="flex shrink-0 flex-col gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-6 pb-3.5 pt-[18px]">
        <div className="flex items-center justify-between">
          <div className="flex items-end gap-2.5">
            <h1 className="text-[22px] font-bold leading-7 text-[var(--text-primary)]">视频浏览</h1>
            <span className="text-xs leading-[1.75] text-[var(--text-tertiary)]">
              共 {total.toLocaleString()} 个视频
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                webOrigin && void window.api.system.openInAppBrowser(webOrigin, '网页端')
              }
              className="flex h-8 items-center gap-2 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] pl-2.5 pr-1 text-[13px] font-medium text-[var(--text-primary)]"
              title={webOrigin || '网页端未启动'}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--text-secondary)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                <path d="M2 12h20" />
              </svg>
              打开网页端
              <span className="flex h-6 items-center gap-1.5 rounded bg-[var(--surface-muted)] px-[7px] font-mono text-[11px] text-[var(--text-secondary)]">
                <i
                  className={`h-1.5 w-1.5 rounded-full ${webOrigin ? 'bg-[var(--success)]' : 'bg-[var(--text-tertiary)]'}`}
                />
                {webOrigin || '未启动'}
              </span>
            </button>
            <button
              onClick={() => setDownloadOpen(true)}
              className="flex h-8 items-center gap-1.5 rounded-[6px] bg-[var(--text-primary)] px-3 text-[13px] font-medium text-white"
            >
              <LinkIcon size={14} />
              解析下载
            </button>
          </div>
        </div>

        {/* 筛选行：窄窗口下整组换行，不压缩组内文字 */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 whitespace-nowrap">
          <div className="relative w-[200px] xl:w-[260px]">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索标题 / 作者 / 标签"
              className="h-8 w-full rounded-[6px] bg-[var(--surface-muted)] pl-8 pr-2.5 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
            />
          </div>
          <div className="relative" ref={authorWrapRef}>
            <button
              onClick={() => setAuthorOpen((open) => !open)}
              className={`flex h-8 items-center gap-1.5 rounded-[6px] border px-2.5 ${
                authorOpen ? 'border-[var(--accent)]' : 'border-[var(--border)]'
              } bg-[var(--surface)]`}
            >
              <UserRound size={14} className="text-[var(--text-secondary)]" />
              <span className="text-xs text-[var(--text-tertiary)]">作者</span>
              <span className="max-w-32 truncate text-[13px] font-medium text-[var(--text-primary)]">
                {authorName}
              </span>
              {authorOpen ? (
                <ChevronUp size={14} className="text-[var(--text-secondary)]" />
              ) : (
                <ChevronDown size={14} className="text-[var(--text-secondary)]" />
              )}
            </button>
            {authorOpen && (
              <div className="absolute left-0 top-9 z-20 w-[260px] rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[0_10px_30px_#0000001F,0_1px_3px_#0000000D]">
                <div className="px-0.5 pb-1.5 pt-0.5">
                  <div className="relative">
                    <Search
                      size={13}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
                    />
                    <input
                      value={authorSearch}
                      onChange={(event) => setAuthorSearch(event.target.value)}
                      placeholder="搜索作者…"
                      className="h-7 w-full rounded-[6px] bg-[var(--surface-muted)] pl-7 pr-2 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                    />
                  </div>
                </div>
                <button
                  onClick={() => {
                    setAuthor('')
                    setAuthorOpen(false)
                  }}
                  className={`flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px] ${
                    !author
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'text-[var(--text-primary)] hover:bg-[var(--surface-muted)]'
                  }`}
                >
                  <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full bg-[var(--surface-muted)]">
                    <Users size={12} className="text-[var(--text-secondary)]" />
                  </span>
                  <span className={`flex-1 ${!author ? 'font-medium' : ''}`}>全部作者</span>
                  <span
                    className={`font-mono text-[11px] ${!author ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'}`}
                  >
                    {total.toLocaleString()}
                  </span>
                  <span className="grid h-3.5 w-3.5 shrink-0 place-items-center">
                    {!author && <Check size={14} />}
                  </span>
                </button>
                <div className="my-1 h-px bg-[var(--border)]" />
                <div className="max-h-56 overflow-y-auto">
                  {filteredAuthors.map((item) => {
                    const creator = creatorRecords.find((user) => user.sec_uid === item.sec_uid)
                    const active = author === item.sec_uid
                    return (
                      <button
                        key={item.sec_uid}
                        onClick={() => {
                          setAuthor(active ? '' : item.sec_uid)
                          setAuthorOpen(false)
                        }}
                        className={`flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px] ${
                          active
                            ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                            : 'text-[var(--text-primary)] hover:bg-[var(--surface-muted)]'
                        }`}
                      >
                        {creator?.avatar_path ? (
                          <img
                            src={toMediaSrc(creator.avatar_path)}
                            className="h-5 w-5 rounded-full object-cover"
                          />
                        ) : (
                          <span className="h-5 w-5 rounded-full bg-[var(--accent-soft)]" />
                        )}
                        <span className="flex-1 truncate">{item.nickname}</span>
                        <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                          {creator?.downloaded_count ?? ''}
                        </span>
                        <span className="grid h-3.5 w-3.5 shrink-0 place-items-center">
                          {active && <Check size={14} />}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center justify-between border-t border-[var(--border)] px-2 pb-0.5 pt-1.5">
                  <span className="text-[11px] text-[var(--text-tertiary)]">
                    共 {creatorRecords.length} 位作者 · {hiddenCreators.length} 位已隐藏
                  </span>
                  <button
                    onClick={() => navigate('/creators')}
                    className="text-[11px] font-medium text-[var(--accent)]"
                  >
                    管理
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="h-5 w-px bg-[var(--border)]" />
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs font-medium text-[var(--text-secondary)]">内容分级</span>
            <div className="flex h-7 items-center gap-0.5 rounded-[6px] bg-[var(--surface-muted)] p-0.5">
              {Array.from({ length: 10 }, (_, index) => index + 1).map((level) => (
                <button
                  key={level}
                  onClick={() =>
                    setLevels((current) =>
                      current[0] === level && current[1] === level ? [0, 10] : [level, level]
                    )
                  }
                  className={`h-full w-6 rounded font-mono text-[11px] font-medium ${
                    level >= levels[0] && level <= levels[1]
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
            <span className="text-xs text-[var(--accent)]">
              {levels[0]}–{levels[1]}
            </span>
          </div>
          <div className="h-5 w-px bg-[var(--border)]" />
          <button
            onClick={() => setAnalyzedOnly((v) => !v)}
            className="flex shrink-0 items-center gap-2"
            role="switch"
            aria-checked={analyzedOnly}
          >
            <span
              className={`flex h-[18px] w-8 items-center rounded-full p-0.5 transition-colors ${
                analyzedOnly ? 'justify-end bg-[var(--accent)]' : 'bg-[var(--border)]'
              }`}
            >
              <span className="h-3.5 w-3.5 rounded-full bg-white shadow-sm" />
            </span>
            <span className="text-[13px] text-[var(--text-primary)]">仅显示已分析</span>
          </button>
          <div className="flex-1" />
          {activeFilter && (
            <button
              onClick={clearFilters}
              className="flex h-7 items-center gap-1 rounded-[6px] px-2 text-xs font-medium text-[var(--accent)]"
            >
              <X size={13} />
              清除筛选
            </button>
          )}
        </div>

        {/* 标签行 */}
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
            <Tags size={14} />
            标签筛选
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {visibleTags.map((item) => {
              const on = selectedTags.includes(item.tag)
              return (
                <button
                  key={item.tag}
                  onClick={() => toggleTag(item.tag)}
                  className={`flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs ${
                    on
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                      : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)]'
                  }`}
                >
                  {on && <Check size={12} />}
                  {item.tag}
                  <span
                    className={`text-[10px] ${on ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'}`}
                  >
                    {item.count}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="relative w-[150px]">
            <Search
              size={13}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
            />
            <input
              value={tagSearch}
              onChange={(event) => setTagSearch(event.target.value)}
              placeholder="搜索标签…"
              className="h-7 w-full rounded-[6px] bg-[var(--surface-muted)] pl-7 pr-2 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
            />
          </div>
          {tags.length > 12 && (
            <button
              onClick={() => setShowAllTags((show) => !show)}
              className="flex h-6 shrink-0 items-center gap-0.5 px-1 text-xs font-medium text-[var(--text-secondary)]"
            >
              {showAllTags ? '收起' : `展开 (${tags.length})`}
              <ChevronDown
                size={13}
                className={showAllTags ? 'rotate-180 transition-transform' : 'transition-transform'}
              />
            </button>
          )}
          {selectedTags.length > 0 && (
            <>
              <div className="h-4 w-px bg-[var(--border)]" />
              <button
                onClick={() => setSelectedTags([])}
                className="shrink-0 text-xs font-medium text-[var(--accent)]"
              >
                清除 ({selectedTags.length})
              </button>
            </>
          )}
        </div>
      </div>

      {/* SubBar：隐藏提示 + 排序 */}
      <div className="flex shrink-0 items-center gap-2 px-6 pb-2.5 pt-3">
        {hiddenCreators.length > 0 && (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
            <EyeOff size={13} className="shrink-0" />
            <span className="truncate">
              已隐藏 {hiddenCreators.length}{' '}
              位创作者的作品（在创作者设置里关闭了「在视频浏览中显示」）
            </span>
            <span>·</span>
            <button
              onClick={() => navigate('/creators')}
              className="shrink-0 font-medium text-[var(--accent)]"
            >
              管理
            </button>
          </span>
        )}
        <div className="flex-1" />
        <span className="shrink-0 whitespace-nowrap text-xs text-[var(--text-tertiary)]">排序</span>
        <div className="flex h-7 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-[6px] bg-[var(--surface-muted)] p-0.5">
          {sortOptions.map((item) => (
            <button
              key={item.field}
              onClick={() => setSort((current) => ({ ...current, field: item.field }))}
              className={`flex h-full items-center rounded px-2.5 text-xs ${
                sort.field === item.field
                  ? 'bg-[var(--surface)] font-medium text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex h-7 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-[6px] border border-[var(--border)] bg-[var(--surface)] p-0.5">
          <button
            onClick={() => setSort((current) => ({ ...current, order: 'ASC' }))}
            className={`flex h-full items-center gap-1 rounded px-2 text-xs ${
              sort.order === 'ASC'
                ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            <ArrowUpNarrowWide size={13} />
            升序
          </button>
          <button
            onClick={() => setSort((current) => ({ ...current, order: 'DESC' }))}
            className={`flex h-full items-center gap-1 rounded px-2 text-xs ${
              sort.order === 'DESC'
                ? 'bg-[var(--accent-soft)] font-medium text-[var(--accent)]'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            <ArrowDownWideNarrow size={13} />
            降序
          </button>
        </div>
      </div>

      {/* 卡片网格 */}
      <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-1">
        {loading && posts.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-[var(--text-tertiary)]">
            加载中…
          </div>
        ) : posts.length === 0 ? (
          <div className="grid h-full min-h-80 place-items-center text-center">
            <div>
              <Video className="mx-auto mb-3 text-[var(--text-tertiary)]" size={40} />
              <p className="text-sm text-[var(--text-secondary)]">暂无视频</p>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                下载的视频会显示在这里，供你浏览和播放
              </p>
              <button
                className="mt-4 h-8 rounded-[6px] bg-[var(--text-primary)] px-4 text-[13px] font-medium text-white"
                onClick={() => setDownloadOpen(true)}
              >
                解析下载
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(134px,1fr))] gap-x-[18px] gap-y-[18px]">
            {posts.map((post) => (
              <BrowseCard
                key={post.id}
                post={post}
                cover={covers[post.aweme_id]}
                onOpen={openPost}
                onSelect={setSelected}
                onAnnotate={() => navigate(`/tags/video/${post.id}`)}
                onCreator={() => navigate(`/creators?user=${encodeURIComponent(post.sec_uid)}`)}
              />
            ))}
          </div>
        )}
        <div ref={gridRef} className="h-8 text-center text-[10px] text-[var(--text-tertiary)]">
          {loadingMore ? '加载中…' : !hasMore && posts.length > 0 ? '已加载全部作品' : ''}
        </div>
      </main>

      {/* Footer：加载进度 + 快捷键 */}
      <footer className="flex shrink-0 items-center gap-2.5 border-t border-[var(--border)] bg-[var(--surface)] px-6 py-2.5">
        <span className="flex items-center gap-1.5 text-xs">
          <span className="text-[var(--text-secondary)]">已加载</span>
          <span className="font-mono text-xs font-medium text-[var(--text-primary)]">
            {posts.length} / {total.toLocaleString()}
          </span>
        </span>
        <div className="h-1 w-[120px] overflow-hidden rounded-sm bg-[var(--surface-muted)]">
          <div
            className="h-full rounded-sm bg-[var(--accent)]"
            style={{
              width: `${total ? Math.min((posts.length / total) * 100, 100) : 0}%`
            }}
          />
        </div>
        <span className="text-xs text-[var(--text-tertiary)]">向下滚动自动加载更多</span>
        <div className="flex-1" />
        <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
          <kbd className="flex h-[18px] items-center rounded border border-[var(--border)] px-[5px] text-[10px] text-[var(--text-secondary)]">
            Space
          </kbd>
          播放
          <kbd className="ml-1 flex h-[18px] items-center rounded border border-[var(--border)] px-[5px] text-[10px] text-[var(--text-secondary)]">
            →
          </kbd>
          下一个
        </span>
      </footer>
      <MediaViewer
        post={selected}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        allPosts={posts}
        onSelectPost={setSelected}
        onAnnotate={(postId) => navigate(`/tags/video/${postId}`)}
        onViewCreator={(secUid) => navigate(`/creators?user=${encodeURIComponent(secUid)}`)}
      />
      <VideoDownloadDialog open={downloadOpen} onOpenChange={setDownloadOpen} />
    </div>
  )
}

function BrowseCard({
  post,
  cover,
  onOpen,
  onSelect,
  onAnnotate,
  onCreator
}: {
  post: DbPost
  cover?: string
  onOpen: (post: DbPost) => void
  onSelect: (post: DbPost) => void
  onAnnotate: () => void
  onCreator: () => void
}): React.JSX.Element {
  const tags = getMergedTags(post)
  const isAlbum = post.aweme_type === 68
  const level = post.analysis_content_level
  const [imageCount, setImageCount] = useState<number | null>(null)
  useEffect(() => {
    if (!isAlbum) return
    let alive = true
    window.api.post
      .getMediaFiles(post.sec_uid, post.folder_name, post.aweme_type)
      .then((media) => {
        if (alive) setImageCount(media?.images?.length ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [isAlbum, post.sec_uid, post.folder_name, post.aweme_type])
  const pill =
    level == null
      ? null
      : level >= 8
        ? 'bg-[var(--success-soft)] text-[var(--success)]'
        : level >= 5
          ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
          : 'bg-[var(--surface-muted)] text-[var(--text-secondary)]'
  const redownload = async (): Promise<void> => {
    try {
      await window.api.post.redownload(post.aweme_id)
      toast.success('已标记重新下载')
    } catch (error) {
      toast.error(`重新下载失败：${(error as Error).message}`)
    }
  }
  const cardRef = useRef<HTMLButtonElement>(null)
  const openMenuAt = (event: React.MouseEvent): void => {
    event.stopPropagation()
    event.preventDefault()
    cardRef.current?.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY
      })
    )
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          ref={cardRef}
          onClick={() => onOpen(post)}
          onContextMenu={() => onSelect(post)}
          className="group flex min-w-0 flex-col gap-2 rounded-lg p-0.5 text-left outline-none data-[state=open]:ring-2 data-[state=open]:ring-[var(--accent)]"
        >
          <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-[#2A2A2E]">
            {cover ? (
              <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-[#6E6E73]">
                {isAlbum ? <Images size={32} /> : <Video size={32} />}
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/55 to-transparent" />
            <span className="absolute left-1.5 top-1.5 flex h-5 items-center gap-1 rounded-[5px] bg-black/35 px-1.5 text-[11px] font-medium text-white backdrop-blur-sm">
              {isAlbum ? <Images size={11} /> : <Play size={11} />}
              {isAlbum ? '图集' : '视频'}
              {isAlbum && imageCount !== null && (
                <span className="font-mono text-white/80">{imageCount}</span>
              )}
            </span>
            {isAlbum && imageCount !== null && imageCount > 1 && (
              <span className="absolute bottom-1.5 left-2 flex items-center gap-[3px]">
                {Array.from({ length: Math.min(imageCount, 5) }).map((_, dot) => (
                  <i
                    key={dot}
                    className={`h-1 w-1 rounded-full ${dot === 0 ? 'bg-white' : 'bg-white/45'}`}
                  />
                ))}
              </span>
            )}
            {!isAlbum && post.duration ? (
              <span className="absolute bottom-1.5 right-1.5 font-mono text-[11px] font-medium text-white">
                {Math.floor(post.duration / 60)}:
                {String(Math.floor(post.duration % 60)).padStart(2, '0')}
              </span>
            ) : null}

            <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-white/90 text-[var(--text-primary)]">
                <Play size={20} className="ml-0.5" />
              </span>
            </span>
            <span
              role="button"
              aria-label="更多操作"
              onClick={openMenuAt}
              className="absolute right-1.5 top-1.5 hidden h-6 w-6 place-items-center rounded-[5px] bg-black/35 text-white backdrop-blur-sm hover:bg-black/55 group-hover:grid"
            >
              <Ellipsis size={13} />
            </span>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <p
              className={`h-[18px] truncate text-xs font-medium leading-[18px] ${
                post.caption || post.desc
                  ? 'text-[var(--text-primary)]'
                  : 'font-normal text-[var(--text-tertiary)]'
              }`}
            >
              {post.caption || post.desc || '无标题'}
            </p>
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-secondary)]">
                @{post.nickname || post.sec_uid}
              </span>
              {pill && (
                <span
                  className={`flex h-4 shrink-0 items-center gap-0.5 rounded px-1 text-[10px] font-semibold ${pill}`}
                >
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  {level}
                </span>
              )}
            </div>
            {tags.length > 0 && (
              <div className="flex gap-1 overflow-hidden">
                {tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="h-[18px] max-w-full truncate rounded bg-[var(--surface-muted)] px-[5px] text-[11px] leading-[18px] text-[var(--text-secondary)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60 rounded-[10px] border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-[0_10px_30px_#0000001F,0_1px_3px_#0000000D]">
        <div className="flex items-center gap-2 px-1.5 pb-1.5 pt-1">
          {cover ? (
            <img src={cover} alt="" className="h-10 w-7 rounded-[4px] object-cover" />
          ) : (
            <span className="grid h-10 w-7 place-items-center rounded-[4px] bg-[#2A2A2E] text-[#6E6E73]">
              {isAlbum ? <Images size={12} /> : <Video size={12} />}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-[18px] text-[var(--text-primary)]">
              {post.caption || post.desc || '无标题'}
            </p>
            <p className="truncate text-[11px] leading-4 text-[var(--text-tertiary)]">
              {isAlbum ? '图集' : '视频'}
              {!isAlbum && post.duration
                ? ` · ${Math.floor(post.duration / 60)}:${String(Math.floor(post.duration % 60)).padStart(2, '0')}`
                : ''}
              {' · @'}
              {post.nickname || post.sec_uid}
            </p>
          </div>
        </div>
        <ContextMenuItem
          onClick={() => onOpen(post)}
          className="h-7 rounded-[6px] px-2 text-xs text-[var(--text-primary)] focus:bg-[var(--accent)] focus:text-white"
        >
          <Play size={13} className="mr-2" />
          播放
          <ContextMenuShortcut className="font-mono text-[10px]">Space</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={onAnnotate}
          className="h-7 rounded-[6px] px-2 text-xs text-[var(--text-primary)] focus:bg-[var(--surface-muted)]"
        >
          <Tag size={13} className="mr-2" />
          添加标签…
          <ContextMenuShortcut className="font-mono text-[10px]">T</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={onAnnotate}
          className="h-7 rounded-[6px] px-2 text-xs text-[var(--text-primary)] focus:bg-[var(--surface-muted)]"
        >
          <SquarePen size={13} className="mr-2" />
          在内容库中编辑标签
          <ContextMenuShortcut className="font-mono text-[10px]">⌘E</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-[var(--border)]" />
        <ContextMenuItem
          onClick={onCreator}
          className="h-7 rounded-[6px] px-2 text-xs text-[var(--text-primary)] focus:bg-[var(--surface-muted)]"
        >
          <UserRound size={13} className="mr-2" />
          该作者的全部作品
          <ContextMenuShortcut className="font-mono text-[10px]">⌘A</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => window.api.post.openFolder(post.sec_uid, post.folder_name)}
          className="h-7 rounded-[6px] px-2 text-xs text-[var(--text-primary)] focus:bg-[var(--surface-muted)]"
        >
          <FolderOpen size={13} className="mr-2" />
          在文件管理器中打开
          <ContextMenuShortcut className="font-mono text-[10px]">⌘R</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator className="bg-[var(--border)]" />
        <ContextMenuItem
          onClick={() => void redownload()}
          className="h-7 rounded-[6px] px-2 text-xs text-[var(--text-primary)] focus:bg-[var(--surface-muted)]"
        >
          <RotateCw size={13} className="mr-2" />
          重新下载
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
