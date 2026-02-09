import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Video,
  Play,
  Images,
  X,
  Tag,
  Flame,
  Search,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { MediaViewer } from '@/components/MediaViewer'
import { VideoDownloadDialog } from '@/components/VideoDownloadDialog'
import { postsApi } from '@/api/client'
import type { DbPost, PostFilters, PostAuthor } from '@dym/shared'

const IMAGE_AWEME_TYPE = 68
const PAGE_SIZE = 50

export default function HomePage() {
  const [posts, setPosts] = useState<DbPost[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
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
  const [showAuthorDropdown, setShowAuthorDropdown] = useState(false)
  const [authorSearch, setAuthorSearch] = useState('')
  const sentinelRef = useRef<HTMLDivElement>(null)
  const authorDropdownRef = useRef<HTMLDivElement>(null)
  const authorSearchInputRef = useRef<HTMLInputElement>(null)

  const filters = useMemo<PostFilters>(
    () => ({
      secUid: selectedSecUid || undefined,
      tags: selectedTags.length > 0 ? selectedTags : undefined,
      minContentLevel: sexyLevelRange[0] > 0 ? sexyLevelRange[0] : undefined,
      maxContentLevel: sexyLevelRange[1] < 10 ? sexyLevelRange[1] : undefined,
      analyzedOnly: analyzedOnly || undefined
    }),
    [selectedSecUid, selectedTags, sexyLevelRange, analyzedOnly]
  )

  useEffect(() => {
    setPosts([])
    setPage(1)
    setHasMore(true)
    loadPosts(1, true)
  }, [filters])

  useEffect(() => {
    loadTags()
  }, [])

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

  const loadPosts = async (pageNum: number, reset = false) => {
    if (reset) {
      setLoading(true)
    } else {
      setLoadingMore(true)
    }
    try {
      const result = await postsApi.getAll(pageNum, PAGE_SIZE, filters)
      if (reset) {
        setPosts(result.posts)
      } else {
        setPosts((prev) => [...prev, ...result.posts])
      }
      setTotal(result.total)
      setAuthors(result.authors)
      setHasMore(result.posts.length === PAGE_SIZE)
    } catch (error) {
      console.error('Failed to load posts:', error)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  const loadMore = useCallback(() => {
    const nextPage = page + 1
    setPage(nextPage)
    loadPosts(nextPage, false)
  }, [page, filters])

  const loadTags = async () => {
    try {
      const tags = await postsApi.getAllTags()
      setAllTags(tags)
    } catch (error) {
      console.error('Failed to load tags:', error)
    }
  }

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }

  const clearFilters = () => {
    setSelectedSecUid('')
    setSelectedTags([])
    setSexyLevelRange([0, 10])
    setAnalyzedOnly(false)
  }

  const hasActiveFilters =
    selectedSecUid ||
    selectedTags.length > 0 ||
    sexyLevelRange[0] > 0 ||
    sexyLevelRange[1] < 10 ||
    analyzedOnly

  const parseTags = (tagsStr: string | null): string[] => {
    if (!tagsStr) return []
    try {
      const tags = JSON.parse(tagsStr)
      return Array.isArray(tags) ? tags : []
    } catch {
      return []
    }
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ''
    const cleaned = dateStr.replace(/[-:T]/g, '').substring(0, 8)
    if (cleaned.length === 8) {
      return `${cleaned.substring(0, 4)}-${cleaned.substring(4, 6)}-${cleaned.substring(6, 8)}`
    }
    return dateStr
  }

  const getCoverUrl = (post: DbPost) => {
    if (!post.folder_name) return null
    return postsApi.getCoverUrl(post.sec_uid, post.folder_name)
  }

  const handlePostClick = (post: DbPost) => {
    setSelectedPost(post)
    setViewerOpen(true)
  }

  const isImagePost = (post: DbPost) => post.aweme_type === IMAGE_AWEME_TYPE

  const selectedAuthor = authors.find((a) => a.sec_uid === selectedSecUid)

  const filteredAuthors = (() => {
    if (!authorSearch.trim()) return authors
    const search = authorSearch.toLowerCase()
    return authors.filter((a) => a.nickname.toLowerCase().includes(search))
  })()

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
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
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-6 border-b border-[#E5E5E7] bg-white">
        <h1 className="text-xl font-semibold text-[#1D1D1F]">视频库</h1>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#A1A1A6]" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="搜索视频..."
              className="h-10 w-[280px] pl-10 pr-4 rounded-lg border border-[#E5E5E7] bg-white text-sm placeholder:text-[#A1A1A6] focus:outline-none focus:ring-2 focus:ring-[#0A84FF]/20 focus:border-[#0A84FF]"
            />
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="px-6 py-4 bg-[#F5F5F7] border-b border-[#E5E5E7]">
        <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-sm">
          <div className="h-[56px] flex items-center justify-between px-5">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-[#6E6E73] uppercase tracking-wide">
                筛选
              </span>

              {/* Author Filter */}
              <div className="relative" ref={authorDropdownRef}>
                <button
                  onClick={() => setShowAuthorDropdown(!showAuthorDropdown)}
                  className="h-8 px-3 flex items-center gap-2 rounded-md border border-[#E5E5E7] bg-white text-sm text-[#1D1D1F] hover:bg-[#F2F2F4] transition-colors"
                >
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
                {showAuthorDropdown && (
                  <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-[#E5E5E7] rounded-lg shadow-md z-50 overflow-hidden">
                    <div className="p-2 border-b border-[#E5E5E7]">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#A1A1A6]" />
                        <input
                          ref={authorSearchInputRef}
                          type="text"
                          defaultValue=""
                          onInput={(e) => {
                            const value = (e.target as HTMLInputElement).value
                            setAuthorSearch(value)
                          }}
                          placeholder="搜索作者..."
                          className="w-full h-8 pl-7 pr-2 rounded-md bg-[#F2F2F4] text-sm text-[#1D1D1F] placeholder:text-[#A1A1A6] focus:outline-none focus:ring-1 focus:ring-[#0A84FF]"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div key={`author-list-${authorSearch}`} className="max-h-60 overflow-y-auto">
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
                        <div className="py-4 text-center text-sm text-[#A1A1A6]">
                          未找到匹配作者
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Tag Filter */}
              <div className="relative">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="h-8 px-3 flex items-center gap-2 rounded-md border border-[#E5E5E7] bg-white text-sm text-[#1D1D1F] hover:bg-[#F2F2F4] transition-colors"
                >
                  <Tag className="h-4 w-4 text-[#6E6E73]" />
                  <span>标签筛选</span>
                  <ChevronDown className="h-4 w-4 text-[#6E6E73]" />
                </button>
                {selectedTags.length > 0 && (
                  <span className="absolute -right-2 -top-2 h-5 w-5 flex items-center justify-center rounded-full bg-[#0A84FF] text-white text-xs">
                    {selectedTags.length}
                  </span>
                )}
              </div>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="text-[#6E6E73] hover:text-[#1D1D1F]"
                >
                  清除筛选
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[13px] text-[#A1A1A6]">共 {total.toLocaleString()} 个视频</span>
            </div>
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
                    <div className="flex items-center gap-2 mb-2">
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
                              className="cursor-pointer hover:bg-[#0A84FF]/80 transition-colors"
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
      </div>

      {/* Main Content - Video Grid */}
      <div className="flex-1 overflow-auto px-6 pb-8">
        <div className="mx-auto max-w-6xl">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0A84FF]" />
            </div>
          ) : posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="rounded-full bg-[#F2F2F4] p-6 mb-4">
                <Video className="h-12 w-12 text-[#A1A1A6]" />
              </div>
              <h2 className="text-xl font-semibold text-[#1D1D1F] mb-2">暂无视频</h2>
              <p className="text-[#6E6E73] mb-4">添加用户并下载视频后，将在这里显示</p>
            </div>
          ) : (
            <>
              {/* 4-Column Masonry Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                {posts.map((post) => (
                  <Card
                    key={post.id}
                    className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow group border-[#E5E5E7] bg-white"
                    onClick={() => handlePostClick(post)}
                  >
                    <div className="aspect-[9/16] bg-[#F2F2F4] relative">
                      {getCoverUrl(post) ? (
                        <img
                          src={getCoverUrl(post)!}
                          alt={post.desc}
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
                      {/* Date badge */}
                      {post.create_time && (
                        <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
                          {formatDate(post.create_time)}
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="text-sm font-medium text-[#1D1D1F] line-clamp-2">
                        {post.desc || post.caption || '无标题'}
                      </p>
                      <p className="text-xs text-[#6E6E73] mt-1">@{post.nickname}</p>
                      {post.analysis_tags && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {parseTags(post.analysis_tags)
                            .slice(0, 3)
                            .map((tag) => (
                              <Badge
                                key={tag}
                                variant="secondary"
                                className="text-xs px-1.5 py-0 bg-[#F2F2F4] text-[#6E6E73]"
                              >
                                {tag}
                              </Badge>
                            ))}
                          {parseTags(post.analysis_tags).length > 3 && (
                            <Badge
                              variant="outline"
                              className="text-xs px-1.5 py-0 border-[#E5E5E7] text-[#A1A1A6]"
                            >
                              +{parseTags(post.analysis_tags).length - 3}
                            </Badge>
                          )}
                        </div>
                      )}
                      {post.analysis_content_level !== null &&
                        post.analysis_content_level > 0 && (
                          <div className="flex items-center gap-1 mt-1.5">
                            <Flame className="h-3 w-3 text-orange-500" />
                            <span className="text-xs text-orange-500">
                              {post.analysis_content_level}
                            </span>
                          </div>
                        )}
                    </div>
                  </Card>
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

      <MediaViewer
        post={selectedPost}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        allPosts={posts}
        onSelectPost={setSelectedPost}
      />

      <VideoDownloadDialog open={downloadDialogOpen} onOpenChange={setDownloadDialogOpen} />
    </div>
  )
}
