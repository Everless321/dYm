import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Download,
  Flame,
  Images,
  LibraryBig,
  Play,
  Search,
  UserRound,
  Video
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MediaViewer } from '@/components/media/MediaViewer'
import { VideoDownloadDialog } from '@/components/media/VideoDownloadDialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
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
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [posts, selected, viewerOpen])

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

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#F5F5F7]">
      <div className="flex shrink-0 items-center gap-2 border-b bg-white px-4 py-2">
        <div className="relative min-w-[180px] flex-1">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#A1A1A6]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索标题、作者或标签"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="relative">
          <button
            onClick={() => setAuthorOpen((open) => !open)}
            className="flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs"
          >
            {author ? authors.find((item) => item.sec_uid === author)?.nickname || '作者' : '作者'}
            <ChevronDown size={13} />
          </button>
          {authorOpen && (
            <div className="absolute left-0 top-9 z-20 w-64 rounded-lg border bg-white p-2 shadow-xl">
              <FacetSearch value={authorSearch} onChange={setAuthorSearch} placeholder="搜索作者" />
              <div className="max-h-56 overflow-y-auto py-1">
                {filteredAuthors.map((item) => {
                  const creator = creatorRecords.find((user) => user.sec_uid === item.sec_uid)
                  return (
                    <button
                      key={item.sec_uid}
                      onClick={() => {
                        setAuthor(author === item.sec_uid ? '' : item.sec_uid)
                        setAuthorOpen(false)
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-[#F2F2F4]"
                    >
                      {creator?.avatar_path ? (
                        <img
                          src={toMediaSrc(creator.avatar_path)}
                          className="h-6 w-6 rounded-full object-cover"
                        />
                      ) : (
                        <span className="h-6 w-6 rounded-full bg-[#E8F0FE]" />
                      )}
                      <span className="flex-1">{item.nickname}</span>
                      <span className="text-[10px] text-[#8E8E93]">
                        {creator?.downloaded_count ?? ''}
                      </span>
                      {author === item.sec_uid && <Check size={13} />}
                    </button>
                  )
                })}
              </div>
              <div className="border-t px-2 pt-2 text-[10px] text-[#8E8E93]">
                共 {creatorRecords.length} 位作者 · {hiddenCreators.length} 位已隐藏 ·{' '}
                <button onClick={() => navigate('/creators')} className="text-[#0A84FF]">
                  管理
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 rounded-md border px-2 py-1">
          <span className="mr-1 flex items-center gap-1 text-[10px] text-[#6E6E73]">
            <Flame size={12} />
            内容分级
          </span>
          {Array.from({ length: 10 }, (_, index) => index + 1).map((level) => (
            <button
              key={level}
              onClick={() =>
                setLevels((current) =>
                  current[0] === level && current[1] === level ? [0, 10] : [level, level]
                )
              }
              className={`h-5 w-5 rounded text-[10px] ${level >= levels[0] && level <= levels[1] ? 'bg-[#E8F0FE] text-[#0A84FF]' : 'text-[#A1A1A6]'}`}
            >
              {level}
            </button>
          ))}
          <span className="ml-1 whitespace-nowrap text-[9px] text-[#8E8E93]">
            {levels[0]}–{levels[1]}
          </span>
        </div>
        <label className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-[#6E6E73]">
          <input
            type="checkbox"
            checked={analyzedOnly}
            onChange={(event) => setAnalyzedOnly(event.target.checked)}
          />
          仅显示已分析
        </label>
        {activeFilter && (
          <button onClick={clearFilters} className="whitespace-nowrap text-xs text-[#0A84FF]">
            清除筛选
          </button>
        )}
        <div className="ml-2 flex items-center gap-2">
          <button
            onClick={() =>
              webOrigin && void window.api.system.openInAppBrowser(webOrigin, '网页端')
            }
            className="flex min-w-[150px] items-center gap-1.5 truncate text-[10px] text-[#6E6E73]"
            title={webOrigin || '网页端不可用'}
          >
            <i
              className={`h-2 w-2 shrink-0 rounded-full ${webOrigin ? 'bg-[#34C759]' : 'bg-[#A1A1A6]'}`}
            />
            打开网页端 · {webOrigin || '未启动'}
          </button>
          <Button
            size="sm"
            className="h-8 bg-[#1D1D1F] text-white"
            onClick={() => setDownloadOpen(true)}
          >
            <Download size={14} />
            解析下载
          </Button>
        </div>
      </div>
      <div className="flex min-h-10 shrink-0 items-center gap-1 overflow-x-auto border-b bg-white px-4">
        <span className="mr-1 whitespace-nowrap text-[10px] text-[#8E8E93]">标签筛选</span>
        {visibleTags.map((item) => (
          <button
            key={item.tag}
            onClick={() => toggleTag(item.tag)}
            className={`shrink-0 rounded-full border px-2 py-1 text-[10px] ${selectedTags.includes(item.tag) ? 'border-[#0A84FF] bg-[#E8F0FE] text-[#0A84FF]' : 'border-transparent text-[#6E6E73] hover:bg-[#F2F2F4]'}`}
          >
            {selectedTags.includes(item.tag) && '✓ '}
            {item.tag}
            <span className="ml-1 text-[#A1A1A6]">{item.count}</span>
          </button>
        ))}
        <Input
          value={tagSearch}
          onChange={(event) => setTagSearch(event.target.value)}
          placeholder="搜索标签"
          className="ml-auto h-7 w-32 text-[10px]"
        />
        {tags.length > 12 && (
          <button
            onClick={() => setShowAllTags((show) => !show)}
            className="whitespace-nowrap text-[10px] text-[#6E6E73]"
          >
            {showAllTags ? '收起' : `展开 (${tags.length})`}
          </button>
        )}
        {selectedTags.length > 0 && (
          <button
            onClick={() => setSelectedTags([])}
            className="whitespace-nowrap text-[10px] text-[#0A84FF]"
          >
            清除 ({selectedTags.length})
          </button>
        )}
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b bg-white px-4">
        <span className="flex-1 truncate text-[10px] text-[#A1A1A6]">
          {hiddenCreators.length
            ? `已隐藏 ${hiddenCreators.length} 位创作者的作品（在创作者设置里关闭）`
            : activeFilter
              ? `当前筛选 · ${total} 个结果`
              : ''}
        </span>
        <span className="text-[10px] text-[#8E8E93]">排序</span>
        <div className="flex rounded bg-[#F2F2F4] p-0.5">
          {sortOptions.map((item) => (
            <button
              key={item.field}
              onClick={() => setSort((current) => ({ ...current, field: item.field }))}
              className={`rounded px-2 py-1 text-[10px] ${sort.field === item.field ? 'bg-white shadow-sm' : 'text-[#6E6E73]'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex rounded border p-0.5">
          <button
            onClick={() => setSort((current) => ({ ...current, order: 'ASC' }))}
            className={`flex items-center gap-1 px-2 py-1 text-[10px] ${sort.order === 'ASC' ? 'bg-[#E8F0FE] text-[#0A84FF]' : ''}`}
          >
            <ArrowUp size={12} />
            升序
          </button>
          <button
            onClick={() => setSort((current) => ({ ...current, order: 'DESC' }))}
            className={`flex items-center gap-1 px-2 py-1 text-[10px] ${sort.order === 'DESC' ? 'bg-[#E8F0FE] text-[#0A84FF]' : ''}`}
          >
            <ArrowDown size={12} />
            降序
          </button>
        </div>
      </div>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading && posts.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-[#8E8E93]">加载中…</div>
        ) : posts.length === 0 ? (
          <div className="grid h-full min-h-80 place-items-center text-center">
            <div>
              <Video className="mx-auto mb-3 text-[#A1A1A6]" size={40} />
              <p className="text-sm text-[#6E6E73]">暂无视频</p>
              <p className="mt-1 text-xs text-[#A1A1A6]">下载的视频会显示在这里，供你浏览和播放</p>
              <Button
                className="mt-4 bg-[#1D1D1F] text-white"
                onClick={() => setDownloadOpen(true)}
              >
                解析下载
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-3 gap-y-4">
            {posts.map((post) => (
              <BrowseCard
                key={post.id}
                post={post}
                cover={covers[post.aweme_id]}
                onOpen={openPost}
                onAnnotate={() => navigate(`/tags/video/${post.id}`)}
                onCreator={() => navigate(`/creators?user=${encodeURIComponent(post.sec_uid)}`)}
              />
            ))}
          </div>
        )}
        <div ref={gridRef} className="h-8 text-center text-[10px] text-[#A1A1A6]">
          {loadingMore ? '加载中…' : !hasMore && posts.length > 0 ? '已加载全部作品' : ''}
        </div>
      </main>
      <footer className="flex h-9 shrink-0 items-center gap-3 border-t bg-white px-4 text-[10px] text-[#8E8E93]">
        <span>
          已加载 {posts.length} / {total.toLocaleString()}
        </span>
        <div className="h-1 w-28 overflow-hidden rounded bg-[#F2F2F4]">
          <div
            className="h-full rounded bg-[#0A84FF]"
            style={{ width: `${total ? Math.min((posts.length / total) * 100, 100) : 0}%` }}
          />
        </div>
        <span>向下滚动自动加载更多</span>
        <span className="ml-auto">
          <kbd className="rounded border px-1">Space</kbd> 播放　
          <kbd className="rounded border px-1">→</kbd> 下一个
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
        className="h-8 pl-7 text-xs"
      />
    </div>
  )
}

function BrowseCard({
  post,
  cover,
  onOpen,
  onAnnotate,
  onCreator
}: {
  post: DbPost
  cover?: string
  onOpen: (post: DbPost) => void
  onAnnotate: () => void
  onCreator: () => void
}): React.JSX.Element {
  const tags = getMergedTags(post)
  const image = post.aweme_type === 68
  const redownload = async (): Promise<void> => {
    try {
      await window.api.post.redownload(post.aweme_id)
      toast.success('已标记重新下载')
    } catch (error) {
      toast.error(`重新下载失败：${(error as Error).message}`)
    }
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button onClick={() => onOpen(post)} className="group min-w-0 text-left">
          <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-[#F2F2F4]">
            {cover ? (
              <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-[#A1A1A6]">
                {image ? <Images size={32} /> : <Video size={32} />}
              </div>
            )}
            <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white">
              {image ? '图集' : '视频'}
            </span>
            {!image && post.duration ? (
              <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
                {Math.floor(post.duration / 60)}:
                {String(Math.floor(post.duration % 60)).padStart(2, '0')}
              </span>
            ) : null}
            <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100">
              <Play size={34} />
            </span>
          </div>
          <p className="mt-2 line-clamp-2 min-h-8 text-xs font-medium leading-4">
            {post.caption || post.desc || '无标题'}
          </p>
          <div className="flex items-center gap-1 text-[10px] text-[#6E6E73]">
            <span className="truncate">@{post.nickname || post.sec_uid}</span>
            <span className="ml-auto flex items-center gap-0.5 text-[#8E8E93]">
              ☆ {post.analysis_content_level || '—'}
            </span>
          </div>
          {tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="max-w-full truncate rounded bg-[#F2F2F4] px-1.5 py-0.5 text-[9px] text-[#6E6E73]"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={() => onOpen(post)}>
          <Play size={14} className="mr-2" />
          播放
        </ContextMenuItem>
        <ContextMenuItem onClick={onAnnotate}>
          <LibraryBig size={14} className="mr-2" />
          在内容库中标注
        </ContextMenuItem>
        <ContextMenuItem onClick={onCreator}>
          <UserRound size={14} className="mr-2" />
          查看创作者
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => window.api.post.openFolder(post.sec_uid, post.folder_name)}>
          在文件管理器中打开
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void redownload()}>
          <Download size={14} className="mr-2" />
          重新下载
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
