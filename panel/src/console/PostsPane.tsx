'use client'

import { useEffect, useRef, useState } from 'react'
import { rpc } from './api'
import { useFeedback } from './feedback'
import { errorMessage, initials, mediaUrl, tone } from './format'
import type { PanelPost, PostListResult, PostQuery } from './types'
import { EmptyState, Loading, MediaImage, Modal } from './widgets'

export function PostsPane({
  nodeId,
  query,
  setQuery,
  reload
}: {
  nodeId: string
  query: PostQuery
  setQuery: (update: (current: PostQuery) => PostQuery) => void
  reload: number
}): React.JSX.Element {
  const { toast } = useFeedback()
  const [draft, setDraft] = useState(query.keyword)
  const [tags, setTags] = useState<string[]>([])
  const [result, setResult] = useState<PostListResult | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<PanelPost | null>(null)
  const tagsLoaded = useRef(false)
  const searchTimer = useRef(0)
  const generation = useRef(0)

  useEffect(() => {
    const mine = ++generation.current
    let cancelled = false
    void (async () => {
      try {
        if (!tagsLoaded.current) {
          const listed = await rpc<{ tags?: string[] }>(nodeId, 'tags.list').catch(() => ({
            tags: [] as string[]
          }))
          if (cancelled || mine !== generation.current) return
          tagsLoaded.current = true
          setTags(listed.tags || [])
        }
        const listed = await rpc<PostListResult>(nodeId, 'posts.list', { ...query })
        if (cancelled || mine !== generation.current) return
        setResult(listed)
        setError('')
      } catch (err) {
        if (cancelled || mine !== generation.current) return
        const message = errorMessage(err)
        setError(message)
        toast(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [nodeId, query, reload, toast])

  useEffect(() => () => window.clearTimeout(searchTimer.current), [])

  function onKeyword(value: string): void {
    setDraft(value)
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => {
      setQuery((current) =>
        current.keyword === value ? current : { ...current, keyword: value, page: 1 }
      )
    }, 300)
  }

  const closePost = (): void => setSelected(null)
  const pages = Math.max(1, Math.ceil((result?.total || 0) / (result?.pageSize || 1)))

  return (
    <div className="stack">
      {!result && !error ? <Loading text="正在读取作品" /> : null}
      {error && !result ? (
        <section className="surface">
          <EmptyState title="读取失败" body={error} />
        </section>
      ) : null}
      {result ? (
        <>
          <section className="surface">
            <div className="filters">
              <label className="field grow">
                关键词
                <input
                  placeholder="描述、作者或标签"
                  autoComplete="off"
                  value={draft}
                  onChange={(event) => onKeyword(event.target.value)}
                />
              </label>
              <label className="field">
                作者
                <select
                  value={query.secUid}
                  onChange={(event) => {
                    const secUid = event.target.value
                    setQuery((current) => ({ ...current, secUid, page: 1 }))
                  }}
                >
                  <option value="">全部作者</option>
                  {result.authors.map((author) => (
                    <option key={author.secUid} value={author.secUid}>
                      {author.nickname}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                标签
                <select
                  value={query.tag}
                  onChange={(event) => {
                    const tag = event.target.value
                    setQuery((current) => ({ ...current, tag, page: 1 }))
                  }}
                >
                  <option value="">全部标签</option>
                  {tags.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={query.analyzedOnly}
                  onChange={(event) => {
                    const analyzedOnly = event.target.checked
                    setQuery((current) => ({ ...current, analyzedOnly, page: 1 }))
                  }}
                />
                只看已分析
              </label>
            </div>
          </section>
          {result.posts.length ? (
            <div className="library">
              {result.posts.map((post) => {
                const seed = post.author?.nickname || post.awemeId
                const label = post.desc || post.caption || post.awemeId
                const cover = mediaUrl(nodeId, post.cover)
                const chips = (post.analysis?.tags || []).slice(0, 2)
                return (
                  <button
                    key={post.id || post.awemeId}
                    className={`asset t${tone(seed)}`}
                    type="button"
                    aria-label={label}
                    onClick={() => setSelected(post)}
                  >
                    <span className="asset-media">
                      {cover ? (
                        <MediaImage src={cover} fallback={initials(seed)} />
                      ) : (
                        <span className="cover-fallback">{initials(seed)}</span>
                      )}
                      {post.isImagePost ? <span className="flag">图文</span> : null}
                    </span>
                    <span className="asset-meta">
                      <strong>{label}</strong>
                      <span className="sub">{post.author?.nickname || '未知作者'}</span>
                      {chips.length ? (
                        <span className="chips">
                          {chips.map((tag) => (
                            <em key={tag}>{tag}</em>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <section className="surface">
              <EmptyState title="没有符合条件的作品" body="换一个关键词、作者或标签后再看。" />
            </section>
          )}
          <div className="pager">
            <span className="muted">
              第 {result.page.toLocaleString('zh-CN')} / {pages.toLocaleString('zh-CN')} 页 · 共{' '}
              {result.total.toLocaleString('zh-CN')} 个
            </span>
            <div className="pager-actions">
              <button
                className="ghost"
                type="button"
                disabled={query.page <= 1}
                onClick={() =>
                  setQuery((current) => ({ ...current, page: Math.max(1, current.page - 1) }))
                }
              >
                上一页
              </button>
              <button
                className="ghost"
                type="button"
                disabled={!result.hasMore}
                onClick={() => setQuery((current) => ({ ...current, page: current.page + 1 }))}
              >
                下一页
              </button>
            </div>
          </div>
        </>
      ) : null}
      <PostDialog nodeId={nodeId} post={selected} onClose={closePost} />
    </div>
  )
}

function PostDialog({
  nodeId,
  post,
  onClose
}: {
  nodeId: string
  post: PanelPost | null
  onClose: () => void
}): React.JSX.Element {
  const images = (post?.images || []).map((image) => mediaUrl(nodeId, image)).filter(Boolean)
  const video = post ? mediaUrl(nodeId, post.video) : ''
  const cover = post ? mediaUrl(nodeId, post.cover) : ''
  const tags = post?.analysis?.tags || []
  return (
    <Modal open={post !== null} wide onClose={onClose}>
      {post ? (
        <div className="viewer">
          <div className="viewer-stage">
            <PostStage post={post} images={images} video={video} cover={cover} />
          </div>
          <div className="viewer-copy">
            <div className="spread">
              <div>
                <p className="eyebrow">{post.author?.nickname || '未知作者'}</p>
                <h2>{post.desc || post.caption || post.awemeId}</h2>
              </div>
              <button className="ghost" type="button" onClick={onClose}>
                关闭
              </button>
            </div>
            {post.analysis?.summary ? (
              <p>{post.analysis.summary}</p>
            ) : (
              <p className="muted">还没有分析摘要</p>
            )}
            {tags.length ? (
              <div className="chips">
                {tags.map((tag) => (
                  <em key={tag}>{tag}</em>
                ))}
              </div>
            ) : null}
            <p className="muted">作品 {post.awemeId}</p>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

function PostStage({
  post,
  images,
  video,
  cover
}: {
  post: PanelPost
  images: string[]
  video: string
  cover: string
}): React.JSX.Element {
  if (post.isImagePost) {
    const sources = images.length ? images : cover ? [cover] : []
    if (!sources.length) return <p className="muted">没有可显示的图片</p>
    return (
      <>
        {sources.map((src) => (
          <StageMedia key={src} src={src} />
        ))}
      </>
    )
  }
  if (video) return <StageMedia src={video} video />
  if (cover) return <StageMedia src={cover} />
  return <p className="muted">没有可播放的文件</p>
}

function StageMedia({ src, video }: { src: string; video?: boolean }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (failed) return <p className="muted">文件无法显示</p>
  if (video) {
    return <video controls autoPlay src={src} onError={() => setFailed(true)} />
  }
  return <img alt="" src={src} onError={() => setFailed(true)} />
}
