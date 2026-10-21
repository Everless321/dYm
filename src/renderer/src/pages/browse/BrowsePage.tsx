import { Page } from '@/components/layout/Page'
import { PageHeader } from '@/components/layout/PageHeader'
import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Video,
  Play,
  Images,
  X,
  Tag,
  Flame,
  FolderOpen,
  Download,
  Search,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  UserRound,
  LibraryBig,
  ArrowUp,
  ArrowDown
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { MediaViewer } from '@/components/media/MediaViewer'
import { VideoDownloadDialog } from '@/components/media/VideoDownloadDialog'
import { getInitialSort } from '@/lib/post-sort'
import { getMergedTags, toMediaSrc } from '@/lib/utils'
import BrowsePrototype from './BrowsePrototype'

const IMAGE_AWEME_TYPE = 68
const PAGE_SIZE = 50
const SORT_OPTIONS: { value: PostSortField; label: string }[] = [
  { value: 'create_time', label: '发布时间' },
  { value: 'downloaded_at', label: '下载时间' },
  { value: 'analyzed_at', label: '分析时间' },
  { value: 'analysis_content_level', label: '内容评级' }
]

const isImagePost = (post: DbPost): boolean => post.aweme_type === IMAGE_AWEME_TYPE

interface PostCardProps {
  post: DbPost
  coverUrl: string | null
  onOpen: (post: DbPost) => void
  onAuthorClick: (secUid: string) => void
  onAnnotate: (postId: number) => void
  onViewCreator: (secUid: string) => void
}

// 卡片单独 memo：滚动加载 / 打开弹窗等父级状态变化时，未变的卡片不重渲染
const PostCard = memo(function PostCard({
  post,
  coverUrl,
  onOpen,
  onAuthorClick,
  onAnnotate,
  onViewCreator
}: PostCardProps): React.JSX.Element {
  const tags = useMemo(() => getMergedTags(post), [post])

  const handleRedownload = async (): Promise<void> => {
    try {
      await window.api.post.redownload(post.aweme_id)
      toast.success('已开始重新下载')
    } catch (e) {
      toast.error('重新下载失败: ' + (e as Error).message)
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Card
          className="group cursor-pointer overflow-hidden border-0 bg-transparent p-0 shadow-none transition-colors hover:bg-transparent"
          onClick={() => onOpen(post)}
        >
          <div className="aspect-[9/16] bg-[#F2F2F4] relative">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={post.desc}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                {isImagePost(post) ? (
                  <Images className="h-12 w-12 text-[#A1A1A6]" />
                ) : (
                  <Video className="h-12 w-12 text-[#A1A1A6]" />
                )}
              </div>
            )}
            {/* Play/View overlay */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
              {isImagePost(post) ? (
                <Images className="h-12 w-12 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              ) : (
                <Play className="h-12 w-12 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </div>
            {/* Type badge */}
            <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
              {isImagePost(post) ? '图集' : '视频'}
            </div>
          </div>
          <div className="space-y-1.5 pt-2">
            <p className="text-xs font-medium leading-[17px] text-[#1D1D1F] line-clamp-2">
              {post.desc || post.caption || '无标题'}
            </p>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onAuthorClick(post.sec_uid)
              }}
              title={`查看 @${post.nickname} 的全部作品`}
              className="block max-w-full truncate text-left text-[11px] text-[#6E6E73] hover:text-[#0A84FF] hover:underline transition-colors"
            >
              @{post.nickname}
            </button>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.slice(0, 3).map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="h-[18px] max-w-full truncate rounded bg-[#F2F2F4] px-1.5 py-0 text-[10px] font-normal text-[#6E6E73]"
                  >
                    {tag}
                  </Badge>
                ))}
                {tags.length > 3 && (
                  <Badge
                    variant="outline"
                    className="h-[18px] rounded border-[#E5E5E7] px-1.5 py-0 text-[10px] text-[#A1A1A6]"
                  >
                    +{tags.length - 3}
                  </Badge>
                )}
              </div>
            )}
            {post.analysis_content_level !== null && post.analysis_content_level > 0 && (
              <div className="flex items-center gap-1">
                <Flame className="h-3 w-3 text-[#0A84FF]" />
                <span className="font-mono text-[10px] text-[#0A84FF]">
                  {post.analysis_content_level}
                </span>
              </div>
            )}
          </div>
        </Card>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60 rounded-xl border border-[#E5E5E7] bg-white/95 p-1.5 shadow-lg">
        <div className="px-2 py-2">
          <p className="line-clamp-1 text-xs font-medium text-[#1D1D1F]">
            {post.desc || post.caption || '无标题'}
          </p>
          <p className="mt-1 text-[11px] text-[#A1A1A6]">
            {isImagePost(post) ? '图集' : '视频'} · @{post.nickname}
          </p>
        </div>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onOpen(post)}>
          <Play className="mr-2 h-4 w-4" />
          播放
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onAnnotate(post.id)}>
          <LibraryBig className="mr-2 h-4 w-4" />
          在内容库中标注
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onViewCreator(post.sec_uid)}>
          <UserRound className="mr-2 h-4 w-4" />
          查看创作者
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => window.api.post.openFolder(post.sec_uid, post.folder_name)}>
          <FolderOpen className="h-4 w-4 mr-2" />
          在文件管理器中打开
        </ContextMenuItem>
        <ContextMenuItem onClick={handleRedownload} className="text-[#C27803] focus:text-[#C27803]">
          <RefreshCw className="h-4 w-4 mr-2" />
          重新下载
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})

export function LegacyBrowsePage(): React.JSX.Element {
  const navigate = useNavigate()
  const [posts, setPosts] = useState<DbPost[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [coverPaths, setCoverPaths] = useState<Record<string, string>>({})
  const [selectedPost, setSelectedPost] = useState<DbPost | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [authors, setAuthors] = useState<PostAuthor[]>([])
  const [selectedSecUid, setSelectedSecUid] = useState<string>('')
  const [allTags, setAllTags] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [sexyLevelRange, setSexyLevelRange] = useState<[number, number]>([0, 10])
  const [showFilters, setShowFilters] = useState(false)
  const [analyzedOnly, setAnalyzedOnly] = useState(false)
  const [showAllTags, setShowAllTags] = useState(false)
  const [tagSearch, setTagSearch] = useState('')
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  // 搜索词防抖后的副本：filters 只跟它走，避免每敲一个字就打一次全库 LIKE 查询
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [showAuthorDropdown, setShowAuthorDropdown] = useState(false)
  const [authorSearch, setAuthorSearch] = useState('')
  const [sort, setSort] = useState<PostSortConfig>(() => getInitialSort('home_post_sort'))
  const sentinelRef = useRef<HTMLDivElement>(null)
  const gridScrollRef = useRef<HTMLDivElement>(null)
  const authorDropdownRef = useRef<HTMLDivElement>(null)
  const authorSearchInputRef = useRef<HTMLInputElement>(null)
  // 列表请求序号。筛选切换很快时，慢的旧请求可能晚于新请求返回，用它丢弃过期结果
  const postsRequestSeq = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(searchKeyword.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchKeyword])

  const filters = useMemo<PostFilters>(
    () => ({
      secUid: selectedSecUid || undefined,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      minContentLevel: sexyLevelRange[0] > 0 ? sexyLevelRange[0] : undefined,
      maxContentLevel: sexyLevelRange[1] < 10 ? sexyLevelRange[1] : undefined,
      analyzedOnly: analyzedOnly || undefined,
      keyword: debouncedKeyword || undefined
    }),
    [selectedSecUid, selectedTags, sexyLevelRange, analyzedOnly, debouncedKeyword]
  )

  useEffect(() => {
    localStorage.setItem('home_post_sort', JSON.stringify(sort))
    setPosts([])
    setPage(1)
    setHasMore(true)
    loadPosts(1, true)
  }, [filters, sort])

  useEffect(() => {
    loadTags()
  }, [])

  useEffect(() => {
    if (posts.length > 0) {
      loadCoverPaths(posts)
    }
  }, [posts])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          loadMore()
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, page])

  // 只补缺失的封面路径并合并进现有 map；翻页时 posts 是累积数组，
  // 原先每次都对全部作品重新逐个 await，一页页往下翻 IPC 次数会线性膨胀
  const loadCoverPaths = async (postList: DbPost[]): Promise<void> => {
    const missing = postList.filter((p) => p.folder_name && !coverPaths[p.aweme_id])
    if (missing.length === 0) return
    const entries = await Promise.all(
      missing.map(async (post) => {
        try {
          const path = await window.api.post.getCoverPath(post.sec_uid, post.folder_name)
          return [post.aweme_id, path] as const
        } catch {
          return [post.aweme_id, null] as const
        }
      })
    )
    setCoverPaths((prev) => {
      const next = { ...prev }
      for (const [awemeId, path] of entries) {
        if (path) next[awemeId] = path
      }
      return next
    })
  }

  const loadPosts = async (pageNum: number, reset = false): Promise<void> => {
    const seq = ++postsRequestSeq.current
    if (reset) {
      setLoading(true)
    } else {
      setLoadingMore(true)
    }
    try {
      const result = await window.api.post.getAll(pageNum, PAGE_SIZE, filters, sort)
      // 期间又发出了新的请求（筛选/排序变了），这份结果已过期
      if (seq !== postsRequestSeq.current) return
      if (reset) {
        setPosts(result.posts)
      } else {
        setPosts((prev) => [...prev, ...result.posts])
      }
      setTotal(result.total)
      setAuthors(result.authors)
      setHasMore(result.posts.length === PAGE_SIZE)
    } catch (error) {
      if (seq !== postsRequestSeq.current) return
      console.error('Failed to load posts:', error)
    } finally {
      if (seq === postsRequestSeq.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }

  const loadMore = useCallback(() => {
    const nextPage = page + 1
    setPage(nextPage)
    loadPosts(nextPage, false)
  }, [page, filters, sort])

  const loadTags = async (): Promise<void> => {
    try {
      const tags = await window.api.post.getAllTags()
      setAllTags(tags)
    } catch (error) {
      console.error('Failed to load tags:', error)
    }
  }

  const toggleTag = (tag: string): void => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }

  const clearFilters = (): void => {
    setSelectedSecUid('')
    setSelectedTags([])
    setSexyLevelRange([0, 10])
    setAnalyzedOnly(false)
    setSearchKeyword('')
  }

  const hasActiveFilters =
    selectedSecUid ||
    selectedTags.length > 0 ||
    sexyLevelRange[0] > 0 ||
    sexyLevelRange[1] < 10 ||
    analyzedOnly ||
    searchKeyword.trim()

  const getCoverUrl = (post: DbPost): string | null => {
    const path = coverPaths[post.aweme_id]
    if (!path) return null
    return toMediaSrc(path)
  }

  const handlePostClick = useCallback((post: DbPost): void => {
    setSelectedPost(post)
    setViewerOpen(true)
  }, [])

  const annotatePost = useCallback(
    (postId: number) => navigate(`/tags/video/${postId}`),
    [navigate]
  )
  const viewCreator = useCallback(
    (secUid: string) => navigate(`/creators?user=${encodeURIComponent(secUid)}`),
    [navigate]
  )

  // 点击作者名 —— 直接筛选出该作者的全部作品
  const viewAuthorPosts = useCallback((secUid: string): void => {
    setViewerOpen(false)
    setShowAuthorDropdown(false)
    setSelectedSecUid(secUid)
    gridScrollRef.current?.scrollTo({ top: 0 })
  }, [])

  const selectedAuthor = authors.find((a) => a.sec_uid === selectedSecUid)

  const filteredAuthors = (() => {
    if (!authorSearch.trim()) return authors
    const search = authorSearch.toLowerCase()
    return authors.filter((a) => a.nickname.toLowerCase().includes(search))
  })()

  // Close author dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (authorDropdownRef.current && !authorDropdownRef.current.contains(e.target as Node)) {
        setShowAuthorDropdown(false)
      }
    }
    if (showAuthorDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showAuthorDropdown])

  return (
    <Page>
      <PageHeader
        title="视频浏览"
        meta={<span className="text-xs">共 {total.toLocaleString()} 个视频</span>}
        actions={
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#A1A1A6]" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜索标题 / 作者 / 标签"
                className="h-9 w-[240px] rounded-md border border-[#E5E5E7] bg-white pl-9 pr-3 text-[13px] placeholder:text-[#A1A1A6] focus:border-[#0A84FF] focus:outline-none focus:ring-2 focus:ring-[#0A84FF]/20"
              />
            </div>
            <Button
              onClick={() => setDownloadDialogOpen(true)}
              className="h-9 rounded-md bg-[#0A84FF] px-3 text-[13px] font-medium text-white hover:bg-[#0060D5]"
            >
              <Download className="mr-1.5 h-4 w-4" />
              解析下载
            </Button>
          </>
        }
      />

      <div className="shrink-0 border-b border-[#E5E5E7] bg-white px-6">
        <div className="flex h-11 items-center justify-between border-b border-[#E5E5E7]">
          <div className="flex items-center gap-3">
            {/* Author Filter */}
            <div className="relative" ref={authorDropdownRef}>
              <button
                onClick={() => setShowAuthorDropdown(!showAuthorDropdown)}
                className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-[#1D1D1F] transition-colors hover:bg-[#F2F2F4]"
              >
                <span className="text-xs text-[#A1A1A6]">作者</span>
                <span>{selectedAuthor?.nickname || '全部作者'}</span>
                <ChevronDown
                  className={`h-4 w-4 text-[#6E6E73] transition-transform ${showAuthorDropdown ? 'rotate-180' : ''}`}
                />
              </button>
              {selectedSecUid && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedSecUid('')
                  }}
                  className="absolute -right-2 -top-2 h-5 w-5 flex items-center justify-center rounded-full bg-[#0A84FF] text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              {/* Author Dropdown */}
              {showAuthorDropdown && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-[#E5E5E7] rounded-lg shadow-md z-50 overflow-hidden">
                  {/* Search */}
                  <div className="p-2 border-b border-[#E5E5E7]">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#A1A1A6]" />
                      <input
                        ref={authorSearchInputRef}
                        type="text"
                        defaultValue=""
                        onInput={(e) => {
                          setAuthorSearch((e.target as HTMLInputElement).value)
                        }}
                        placeholder="搜索作者..."
                        className="w-full h-8 pl-7 pr-2 rounded-md bg-[#F2F2F4] text-sm text-[#1D1D1F] placeholder:text-[#A1A1A6] focus:outline-none focus:ring-1 focus:ring-[#0A84FF]"
                        autoFocus
                      />
                    </div>
                  </div>
                  {/* Options */}
                  <div className="max-h-60 overflow-y-auto">
                    <button
                      onClick={() => {
                        setSelectedSecUid('')
                        setShowAuthorDropdown(false)
                        setAuthorSearch('')
                        if (authorSearchInputRef.current) {
                          authorSearchInputRef.current.value = ''
                        }
                      }}
                      className={`w-full h-10 px-3 flex items-center gap-2 text-sm hover:bg-[#F2F2F4] transition-colors ${!selectedSecUid ? 'bg-[#E8F0FE] text-[#0A84FF]' : 'text-[#1D1D1F]'}`}
                    >
                      全部作者
                    </button>
                    {filteredAuthors.map((author) => (
                      <button
                        key={author.sec_uid}
                        onClick={() => {
                          setSelectedSecUid(author.sec_uid)
                          setShowAuthorDropdown(false)
                          setAuthorSearch('')
                          if (authorSearchInputRef.current) {
                            authorSearchInputRef.current.value = ''
                          }
                        }}
                        className={`w-full h-10 px-3 flex items-center gap-2 text-sm hover:bg-[#F2F2F4] transition-colors ${selectedSecUid === author.sec_uid ? 'bg-[#E8F0FE] text-[#0A84FF]' : 'text-[#1D1D1F]'}`}
                      >
                        <span className="truncate">{author.nickname}</span>
                      </button>
                    ))}
                    {filteredAuthors.length === 0 && (
                      <div className="py-4 text-center text-sm text-[#A1A1A6]">未找到匹配作者</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Tag Filter */}
            <div className="relative">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-[#1D1D1F] transition-colors hover:bg-[#F2F2F4]"
              >
                <span className="text-xs text-[#6E6E73]">内容分级</span>
                <Flame className="h-3.5 w-3.5 text-[#6E6E73]" />
                <span className="font-mono text-xs text-[#0A84FF]">
                  {sexyLevelRange[0]}–{sexyLevelRange[1]}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-[#6E6E73]" />
              </button>
            </div>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-7 px-2 text-xs text-[#0A84FF] hover:bg-[#E8F0FE] hover:text-[#0060D5]"
              >
                清除筛选
              </Button>
            )}
          </div>
        </div>

        <div className="flex h-10 items-center gap-2 overflow-x-auto">
          <span className="shrink-0 text-xs text-[#6E6E73]">标签筛选</span>
          {allTags.length === 0 ? (
            <span className="text-xs text-[#A1A1A6]">暂无标签</span>
          ) : (
            allTags.slice(0, 12).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`shrink-0 rounded-md border px-2 py-1 text-xs transition-colors ${
                  selectedTags.includes(tag)
                    ? 'border-[#0A84FF]/20 bg-[#E8F0FE] text-[#0A84FF]'
                    : 'border-transparent text-[#6E6E73] hover:bg-[#F2F2F4]'
                }`}
              >
                {tag}
              </button>
            ))
          )}
          {allTags.length > 12 && (
            <button
              type="button"
              onClick={() => setShowFilters(true)}
              className="shrink-0 text-xs text-[#6E6E73] hover:text-[#0A84FF]"
            >
              展开 ({allTags.length})
            </button>
          )}
          {selectedTags.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedTags([])}
              className="ml-auto shrink-0 text-xs text-[#0A84FF]"
            >
              清除 ({selectedTags.length})
            </button>
          )}
        </div>

        {/* Extended Filter Panel */}
        {showFilters && (
          <div className="border-t border-[#E5E5E7] px-5 py-4 space-y-4">
            {/* Sexy Level Filter */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 min-w-[100px]">
                <Flame className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-medium text-[#1D1D1F]">内容分级</span>
              </div>
              <div className="flex-1 max-w-md flex items-center gap-4">
                <span className="text-sm text-[#6E6E73] w-6">{sexyLevelRange[0]}</span>
                <Slider
                  value={sexyLevelRange}
                  onValueChange={(v) => setSexyLevelRange(v as [number, number])}
                  min={0}
                  max={10}
                  step={1}
                  className="flex-1"
                />
                <span className="text-sm text-[#6E6E73] w-6">{sexyLevelRange[1]}</span>
              </div>
              <label className="flex items-center gap-2 text-sm text-[#6E6E73]">
                <input
                  type="checkbox"
                  checked={analyzedOnly}
                  onChange={(e) => setAnalyzedOnly(e.target.checked)}
                  className="rounded border-[#E5E5E7]"
                />
                仅显示已分析
              </label>
            </div>

            {/* Tag Filter */}
            {allTags.length > 0 && (
              <div className="flex items-start gap-4">
                <div className="flex items-center gap-2 min-w-[100px] pt-1">
                  <Tag className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium text-[#1D1D1F]">标签筛选</span>
                </div>
                <div className="flex-1">
                  {/* 搜索框 + 展开/收起按钮 */}
                  <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
                    <div className="relative flex-1 max-w-[200px]">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#A1A1A6]" />
                      <input
                        type="text"
                        value={tagSearch}
                        onChange={(e) => setTagSearch(e.target.value)}
                        placeholder="搜索标签..."
                        className="w-full h-7 pl-7 pr-2 rounded-md bg-[#F2F2F4] text-xs text-[#1D1D1F] placeholder:text-[#A1A1A6] focus:outline-none focus:ring-1 focus:ring-[#0A84FF]"
                      />
                    </div>
                    {allTags.length > 20 && !tagSearch && (
                      <button
                        onClick={() => setShowAllTags(!showAllTags)}
                        className="flex items-center gap-1 text-xs text-[#6E6E73] hover:text-[#0A84FF] transition-colors"
                      >
                        {showAllTags ? (
                          <>
                            <ChevronUp className="h-3 w-3" />
                            收起
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3 w-3" />
                            展开 ({allTags.length})
                          </>
                        )}
                      </button>
                    )}
                    {selectedTags.length > 0 && (
                      <button
                        onClick={() => setSelectedTags([])}
                        className="flex items-center gap-1 text-xs text-[#0A84FF] hover:text-[#0060D5] transition-colors"
                      >
                        <X className="h-3 w-3" />
                        清除 ({selectedTags.length})
                      </button>
                    )}
                  </div>
                  {/* 标签列表（可滚动） */}
                  <div
                    className={`flex flex-wrap gap-2 ${showAllTags || tagSearch ? 'max-h-32 overflow-y-auto' : ''}`}
                  >
                    {(() => {
                      let displayTags = allTags
                      if (tagSearch) {
                        const search = tagSearch.toLowerCase()
                        displayTags = allTags.filter((t) => t.toLowerCase().includes(search))
                      } else if (!showAllTags) {
                        displayTags = allTags.slice(0, 20)
                      }
                      return displayTags.length > 0 ? (
                        displayTags.map((tag) => (
                          <Badge
                            key={tag}
                            variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                            className={`cursor-pointer transition-colors ${selectedTags.includes(tag) ? 'hover:bg-[#0A84FF]/80' : 'hover:bg-[#F2F2F4] hover:border-[#C7C7CC]'}`}
                            onClick={() => toggleTag(tag)}
                          >
                            {tag}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-[#A1A1A6]">未找到匹配标签</span>
                      )
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex h-[50px] shrink-0 items-center gap-3 border-b border-[#E5E5E7] bg-white px-6">
        <div className="flex-1" />
        <span className="text-xs text-[#A1A1A6]">排序</span>
        <div className="flex h-7 items-center rounded-md bg-[#F2F2F4] p-0.5">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setSort((current) => ({ ...current, field: option.value }))}
              className={`h-6 rounded px-2 text-xs transition-colors ${
                sort.field === option.value
                  ? 'bg-white font-medium text-[#1D1D1F] shadow-sm'
                  : 'text-[#6E6E73] hover:text-[#1D1D1F]'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex h-7 overflow-hidden rounded-md border border-[#E5E5E7]">
          {(['ASC', 'DESC'] as const).map((order) => (
            <button
              key={order}
              type="button"
              onClick={() => setSort((current) => ({ ...current, order }))}
              className={`flex items-center gap-1 px-2 text-xs ${
                sort.order === order
                  ? 'bg-[#E8F0FE] text-[#0A84FF]'
                  : 'bg-white text-[#6E6E73] hover:bg-[#F2F2F4]'
              }`}
            >
              {order === 'ASC' ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              )}
              {order === 'ASC' ? '升序' : '降序'}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content - Video Grid */}
      <div ref={gridScrollRef} className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <div className="mx-auto h-full w-full max-w-[1160px]">
          {loading ? (
            <div className="flex h-full min-h-[300px] items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0A84FF]" />
            </div>
          ) : posts.length === 0 ? (
            <div className="flex h-full min-h-[400px] flex-col items-center justify-center text-center">
              <div className="rounded-full bg-[#F2F2F4] p-6 mb-4">
                <Video className="h-12 w-12 text-[#A1A1A6]" />
              </div>
              <h2 className="text-xl font-semibold text-[#1D1D1F] mb-2">暂无视频</h2>
              <p className="mb-4 text-sm text-[#6E6E73]">下载的视频会显示在这里，供你浏览和播放</p>
              <Button
                onClick={() => setDownloadDialogOpen(true)}
                className="h-9 rounded-md bg-[#0A84FF] px-3 text-sm text-white hover:bg-[#0060D5]"
              >
                解析下载
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(134px,1fr))] gap-x-3 gap-y-[22px]">
                {posts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    coverUrl={getCoverUrl(post)}
                    onOpen={handlePostClick}
                    onAuthorClick={viewAuthorPosts}
                    onAnnotate={annotatePost}
                    onViewCreator={viewCreator}
                  />
                ))}
              </div>

              {/* Infinite scroll sentinel */}
              <div ref={sentinelRef} className="h-10 flex items-center justify-center mt-4">
                {loadingMore && (
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[#0A84FF]" />
                )}
                {!hasMore && posts.length > 0 && (
                  <span className="text-sm text-[#A1A1A6]">已加载全部 {total} 个作品</span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <footer className="flex h-[38px] shrink-0 items-center gap-3 border-t border-[#E5E5E7] bg-white px-6">
        <span className="shrink-0 text-xs text-[#6E6E73]">已加载</span>
        <span className="shrink-0 font-mono text-xs text-[#1D1D1F]">
          {posts.length} / {total.toLocaleString()}
        </span>
        <div className="h-1 w-[120px] shrink-0 overflow-hidden rounded-full bg-[#F2F2F4]">
          <div
            className="h-full rounded-full bg-[#0A84FF]"
            style={{ width: `${total ? Math.min((posts.length / total) * 100, 100) : 0}%` }}
          />
        </div>
        <div className="flex-1" />
        <span className="text-xs text-[#A1A1A6]">
          {hasMore ? '向下滚动自动加载更多' : total > 0 ? '已加载全部作品' : ''}
        </span>
      </footer>

      <MediaViewer
        post={selectedPost}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        allPosts={posts}
        onSelectPost={setSelectedPost}
        onAuthorClick={viewAuthorPosts}
        onAnnotate={annotatePost}
        onViewCreator={viewCreator}
      />

      <VideoDownloadDialog open={downloadDialogOpen} onOpenChange={setDownloadDialogOpen} />
    </Page>
  )
}

export default function BrowsePage(): React.JSX.Element {
  return <BrowsePrototype />
}
