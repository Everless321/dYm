import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Settings, Video, Play, Images, X, Filter, Tag, Flame, FolderOpen, Download } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { MediaViewer } from '@/components/MediaViewer'
import { VideoDownloadDialog } from '@/components/VideoDownloadDialog'

const IMAGE_AWEME_TYPE = 68

const PAGE_SIZE = 50

export default function HomePage() {
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
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const filters = useMemo<PostFilters>(() => ({
    secUid: selectedSecUid || undefined,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
    minContentLevel: sexyLevelRange[0] > 0 ? sexyLevelRange[0] : undefined,
    maxContentLevel: sexyLevelRange[1] < 10 ? sexyLevelRange[1] : undefined,
    analyzedOnly: analyzedOnly || undefined
  }), [selectedSecUid, selectedTags, sexyLevelRange, analyzedOnly])

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
    if (posts.length > 0) {
      loadCoverPaths(posts)
    }
  }, [posts])

  // Infinite scroll observer
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

  const loadCoverPaths = async (postList: DbPost[]) => {
    const paths: Record<string, string> = {}
    for (const post of postList) {
      if (post.folder_name) {
        const coverPath = await window.api.post.getCoverPath(post.sec_uid, post.folder_name)
        if (coverPath) {
          paths[post.aweme_id] = coverPath
        }
      }
    }
    setCoverPaths(paths)
  }

  const loadPosts = async (pageNum: number, reset = false) => {
    if (reset) {
      setLoading(true)
    } else {
      setLoadingMore(true)
    }
    try {
      const result = await window.api.post.getAll(pageNum, PAGE_SIZE, filters)
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
      const tags = await window.api.post.getAllTags()
      setAllTags(tags)
    } catch (error) {
      console.error('Failed to load tags:', error)
    }
  }

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  const clearFilters = () => {
    setSelectedSecUid('')
    setSelectedTags([])
    setSexyLevelRange([0, 10])
    setAnalyzedOnly(false)
  }

  const hasActiveFilters = selectedSecUid || selectedTags.length > 0 || sexyLevelRange[0] > 0 || sexyLevelRange[1] < 10 || analyzedOnly

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
    // 格式: 20240101 或 2024-01-01T00:00:00
    const cleaned = dateStr.replace(/[-:T]/g, '').substring(0, 8)
    if (cleaned.length === 8) {
      return `${cleaned.substring(0, 4)}-${cleaned.substring(4, 6)}-${cleaned.substring(6, 8)}`
    }
    return dateStr
  }

  const getCoverUrl = (post: DbPost) => {
    const path = coverPaths[post.aweme_id]
    if (!path) return null
    return `local://${path}`
  }

  const handlePostClick = (post: DbPost) => {
    setSelectedPost(post)
    setViewerOpen(true)
  }

  const isImagePost = (post: DbPost) => post.aweme_type === IMAGE_AWEME_TYPE

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="h-14 border-b border-border flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">dYm</h1>
          {total > 0 && (
            <span className="text-sm text-muted-foreground">
              已加载 {posts.length} / {total} 个作品
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Author Filter */}
          <div className="relative">
            <select
              value={selectedSecUid}
              onChange={(e) => setSelectedSecUid(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring appearance-none pr-8 min-w-[120px]"
            >
              <option value="">全部作者</option>
              {authors.map((author) => (
                <option key={author.sec_uid} value={author.sec_uid}>
                  {author.nickname}
                </option>
              ))}
            </select>
            {selectedSecUid && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-9 w-8"
                onClick={() => setSelectedSecUid('')}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          <Button
            variant={showFilters ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-1"
          >
            <Filter className="h-4 w-4" />
            筛选
            {hasActiveFilters && (
              <span className="ml-1 h-2 w-2 rounded-full bg-primary" />
            )}
          </Button>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              清除
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => setDownloadDialogOpen(true)}>
            <Download className="h-5 w-5" />
          </Button>
          <Link to="/settings">
            <Button variant="ghost" size="icon">
              <Settings className="h-5 w-5" />
            </Button>
          </Link>
        </div>
      </header>

      {/* Filter Panel */}
      {showFilters && (
        <div className="border-b border-border px-6 py-4 space-y-4 bg-muted/30">
          {/* Sexy Level Filter */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 min-w-[100px]">
              <Flame className="h-4 w-4 text-orange-500" />
              <span className="text-sm font-medium">内容分级</span>
            </div>
            <div className="flex-1 max-w-md flex items-center gap-4">
              <span className="text-sm text-muted-foreground w-6">{sexyLevelRange[0]}</span>
              <Slider
                value={sexyLevelRange}
                onValueChange={(v) => setSexyLevelRange(v as [number, number])}
                min={0}
                max={10}
                step={1}
                className="flex-1"
              />
              <span className="text-sm text-muted-foreground w-6">{sexyLevelRange[1]}</span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={analyzedOnly}
                onChange={(e) => setAnalyzedOnly(e.target.checked)}
                className="rounded border-input"
              />
              仅显示已分析
            </label>
          </div>
          {/* Tag Filter */}
          {allTags.length > 0 && (
            <div className="flex items-start gap-4">
              <div className="flex items-center gap-2 min-w-[100px] pt-1">
                <Tag className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium">标签筛选</span>
              </div>
              <div className="flex-1 flex flex-wrap gap-2">
                {allTags.map((tag) => (
                  <Badge
                    key={tag}
                    variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                    className="cursor-pointer hover:bg-primary/80 transition-colors"
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Content */}
      <ScrollArea className="flex-1">
        <main className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
            </div>
          ) : posts.length === 0 ? (
            /* Empty State */
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="rounded-full bg-muted p-6 mb-4">
                <Video className="h-12 w-12 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-semibold mb-2">暂无视频</h2>
              <p className="text-muted-foreground mb-4">前往设置添加用户并下载视频</p>
              <Link to="/settings">
                <Button>
                  <Settings className="h-4 w-4 mr-2" />
                  进入设置
                </Button>
              </Link>
            </div>
          ) : (
            <>
              {/* Video Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {posts.map((post) => (
                <ContextMenu key={post.id}>
                  <ContextMenuTrigger asChild>
                    <Card
                      className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow group"
                      onClick={() => handlePostClick(post)}
                    >
                      <div className="aspect-[9/16] bg-muted relative">
                        {getCoverUrl(post) ? (
                          <img
                            src={getCoverUrl(post)!}
                            alt={post.desc}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            {isImagePost(post) ? (
                              <Images className="h-12 w-12 text-muted-foreground/50" />
                            ) : (
                              <Video className="h-12 w-12 text-muted-foreground/50" />
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
                        <p className="text-sm font-medium line-clamp-2">{post.desc || post.caption || '无标题'}</p>
                        <p className="text-xs text-muted-foreground mt-1">@{post.nickname}</p>
                        {post.analysis_tags && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {parseTags(post.analysis_tags).slice(0, 3).map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">
                                {tag}
                              </Badge>
                            ))}
                            {parseTags(post.analysis_tags).length > 3 && (
                              <Badge variant="outline" className="text-xs px-1.5 py-0">
                                +{parseTags(post.analysis_tags).length - 3}
                              </Badge>
                            )}
                          </div>
                        )}
                        {post.analysis_content_level !== null && post.analysis_content_level > 0 && (
                          <div className="flex items-center gap-1 mt-1.5">
                            <Flame className="h-3 w-3 text-orange-500" />
                            <span className="text-xs text-orange-500">{post.analysis_content_level}</span>
                          </div>
                        )}
                      </div>
                    </Card>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onClick={() => window.api.post.openFolder(post.sec_uid, post.folder_name)}
                    >
                      <FolderOpen className="h-4 w-4 mr-2" />
                      在文件管理器中打开
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-10 flex items-center justify-center mt-4">
              {loadingMore && (
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground" />
              )}
              {!hasMore && posts.length > 0 && (
                <span className="text-sm text-muted-foreground">已加载全部 {total} 个作品</span>
              )}
            </div>
            </>
          )}
        </main>
      </ScrollArea>

      <MediaViewer
        post={selectedPost}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
      />

      <VideoDownloadDialog
        open={downloadDialogOpen}
        onOpenChange={setDownloadDialogOpen}
      />
    </div>
  )
}
