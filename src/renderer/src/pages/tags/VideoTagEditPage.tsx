import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronLeft, Play, X, Plus, Sparkles, Loader2, RotateCw, Hand } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MediaViewer } from '@/components/MediaViewer'
import { parseTags } from '@/lib/utils'

export default function VideoTagEditPage() {
  const { postId = '' } = useParams()
  const id = Number(postId)
  const navigate = useNavigate()
  const [post, setPost] = useState<DbPost | null>(null)
  const [cover, setCover] = useState<string | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [reanalyzing, setReanalyzing] = useState(false)

  const load = useCallback(async () => {
    const p = await window.api.tag.getPost(id)
    setPost(p || null)
    if (p) {
      const c = await window.api.post.getCoverPath(p.sec_uid, p.folder_name)
      setCover(c)
    }
  }, [id])

  useEffect(() => {
    load()
    window.api.tag.getTagsWithFrequency().then((list) => {
      setSuggestions(list.slice(0, 24).map((t) => t.tag))
    })
  }, [load])

  useEffect(() => {
    const unsub = window.api.analysis.onProgress((p) => {
      if (p.status === 'completed' || p.status === 'failed' || p.status === 'stopped') {
        setReanalyzing(false)
        load()
      }
    })
    return unsub
  }, [load])

  if (!post) {
    return <div className="p-10 text-sm text-[#A1A1A6]">加载中…</div>
  }

  const aiTags = parseTags(post.analysis_tags)
  const manualTags = parseTags(post.manual_tags)

  const save = async (input: { aiTags?: string[]; manualTags?: string[] }) => {
    await window.api.tag.setPostTags(id, input)
    load()
  }

  const removeAi = (t: string) => save({ aiTags: aiTags.filter((x) => x !== t) })
  const removeManual = (t: string) => save({ manualTags: manualTags.filter((x) => x !== t) })
  const addManual = (t: string) => {
    const tag = t.trim()
    if (!tag) return
    if (manualTags.includes(tag) || aiTags.includes(tag)) {
      toast.info('标签已存在')
      return
    }
    save({ manualTags: [...manualTags, tag] })
    setInput('')
  }

  const handleReanalyze = async () => {
    try {
      const running = await window.api.analysis.isRunning()
      if (running) {
        toast.error('已有分析任务在进行中')
        return
      }
      setReanalyzing(true)
      await window.api.analysis.reanalyzePost(id)
    } catch (error) {
      setReanalyzing(false)
      toast.error(`重新分析失败: ${(error as Error).message}`)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="h-16 flex items-center px-8 border-b border-[#E5E5E7] bg-white shrink-0">
        <button
          onClick={() => navigate(`/tags/user/${post.sec_uid}`)}
          className="flex items-center gap-1 text-sm text-[#6E6E73] hover:text-[#1D1D1F]"
        >
          <ChevronLeft className="h-4 w-4" />
          返回视频库
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="flex gap-8 max-w-5xl">
          {/* Left: preview */}
          <div className="w-80 shrink-0 space-y-4">
            <div
              className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-[#1D1D1F] cursor-pointer group shadow-sm"
              onClick={() => setViewerOpen(true)}
            >
              {cover ? (
                <img src={`local://${cover}`} className="w-full h-full object-cover" alt="" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white/40">
                  无封面
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                <Play className="h-12 w-12 text-white" />
              </div>
            </div>
            <div className="rounded-xl border border-[#E5E5E7] bg-white p-4 space-y-2">
              <p className="text-sm text-[#1D1D1F] leading-relaxed">
                {post.desc || post.caption || '无描述'}
              </p>
              {post.analysis_summary && (
                <p className="text-xs text-[#A1A1A6] leading-relaxed">{post.analysis_summary}</p>
              )}
            </div>
          </div>

          {/* Right: tag editing */}
          <div className="flex-1 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#1D1D1F]">标签编辑</h2>
              <Button variant="outline" onClick={handleReanalyze} disabled={reanalyzing}>
                {reanalyzing ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <RotateCw className="h-4 w-4 mr-1.5" />
                )}
                {reanalyzing ? '分析中…' : '重新分析'}
              </Button>
            </div>

            <TagSection
              title="AI 标签"
              icon={<Sparkles className="h-4 w-4 text-[#0A84FF]" />}
              tags={aiTags}
              color="#0A84FF"
              bg="#E8F0FE"
              onRemove={removeAi}
              empty="暂无 AI 标签，可点击「重新分析」生成"
            />

            <TagSection
              title="手动标签"
              icon={<Hand className="h-4 w-4 text-[#34C759]" />}
              tags={manualTags}
              color="#34C759"
              bg="#E8F8EE"
              onRemove={removeManual}
              empty="暂无手动标签"
            />

            {/* Add + suggestions */}
            <div className="rounded-xl border border-[#E5E5E7] bg-white p-5 space-y-4">
              <div className="flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addManual(input)}
                  placeholder="输入标签后回车添加"
                  className="flex-1"
                />
                <Button onClick={() => addManual(input)}>
                  <Plus className="h-4 w-4 mr-1" />
                  添加
                </Button>
              </div>
              {suggestions.length > 0 && (
                <div className="space-y-2.5">
                  <p className="text-xs text-[#A1A1A6]">推荐标签（点击采纳）</p>
                  <div className="flex flex-wrap gap-2">
                    {suggestions
                      .filter((t) => !aiTags.includes(t) && !manualTags.includes(t))
                      .map((t) => (
                        <button
                          key={t}
                          onClick={() => addManual(t)}
                          className="px-3 py-1.5 rounded-full text-xs bg-[#F5F5F7] text-[#6E6E73] hover:bg-[#E8F0FE] hover:text-[#0A84FF] transition-colors"
                        >
                          + {t}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <MediaViewer post={post} open={viewerOpen} onOpenChange={setViewerOpen} />
    </div>
  )
}

function TagSection({
  title,
  icon,
  tags,
  color,
  bg,
  onRemove,
  empty
}: {
  title: string
  icon?: React.ReactNode
  tags: string[]
  color: string
  bg: string
  onRemove: (t: string) => void
  empty: string
}) {
  return (
    <div className="rounded-xl border border-[#E5E5E7] bg-white p-5">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <span className="text-sm font-medium text-[#1D1D1F]">{title}</span>
        <span className="text-xs text-[#A1A1A6]">({tags.length})</span>
      </div>
      {tags.length === 0 ? (
        <p className="text-xs text-[#C7C7CC]">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-2.5">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full text-xs font-medium"
              style={{ color, backgroundColor: bg }}
            >
              {t}
              <button
                onClick={() => onRemove(t)}
                className="rounded-full p-0.5 hover:bg-black/10 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
