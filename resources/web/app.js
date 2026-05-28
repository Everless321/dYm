const state = {
  tags: [],
  authors: [],
  posts: [],
  page: 1,
  pageSize: 18,
  total: 0,
  hasMore: true,
  loading: false,
  globalMuted: true,
  activePostId: null,
  playerPosts: [],
  playerStartIndex: 0,
  imageAutoTimer: null,
  imageManualOverride: new Set(),
  filters: {
    secUid: '',
    keyword: '',
    analyzedOnly: false
  }
}

const IMAGE_AUTO_INTERVAL = 3000

const el = {
  browseView: document.getElementById('browseView'),
  playerView: document.getElementById('playerView'),
  playerBack: document.getElementById('playerBack'),
  playerFeed: document.getElementById('playerFeed'),
  authorScroll: document.getElementById('authorScroll'),
  grid: document.getElementById('grid'),
  gridLoading: document.getElementById('gridLoading'),
  toast: document.getElementById('toast'),
  searchInput: document.getElementById('searchInput'),
  searchClear: document.getElementById('searchClear'),
  analyzedToggle: document.getElementById('analyzedToggle')
}

let storyObserver = null
let toastTimer = null

const icons = {
  muted:
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M5 9v6h4l5 4V5L9 9H5Zm11.59 3 2.7 2.7-1.42 1.42-2.7-2.7-2.7 2.7-1.42-1.42 2.7-2.7-2.7-2.7 1.42-1.42 2.7 2.7 2.7-2.7 1.42 1.42-2.7 2.7Z"/></svg>',
  volume:
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M5 9v6h4l5 4V5L9 9H5Zm11.5 3a4.5 4.5 0 0 0-2.14-3.83v7.66A4.5 4.5 0 0 0 16.5 12Zm-2.14-8.24v2.06a8 8 0 0 1 0 12.36v2.06c3.45-1.35 5.89-4.71 5.89-8.24s-2.44-6.89-5.89-8.24Z"/></svg>',
  chevronLeft:
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="m14.7 6.3-1.4-1.4L6.2 12l7.1 7.1 1.4-1.4L9 12l5.7-5.7Z"/></svg>',
  chevronRight:
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="m9.3 17.7 1.4 1.4 7.1-7.1-7.1-7.1-1.4 1.4L15 12l-5.7 5.7Z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>'
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function truncate(value, max = 60) {
  const t = String(value ?? '').trim()
  return !t ? '' : t.length > max ? t.slice(0, max) + '...' : t
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

function formatDate(value) {
  if (!value) return ''
  if (/^\d{8}/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  return value.slice(0, 10)
}

function showToast(msg) {
  el.toast.textContent = msg
  el.toast.classList.add('is-visible')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 2200)
}

async function fetchJson(path) {
  const res = await fetch(path, { cache: 'no-store' })
  if (!res.ok) {
    const p = await res.json().catch(() => ({}))
    throw new Error(p.error || `${res.status}`)
  }
  return res.json()
}

// ── Author Bar ──

function renderAuthors() {
  const items = [{ sec_uid: '', nickname: '全部' }, ...state.authors]
  el.authorScroll.innerHTML = items
    .map(
      (a) =>
        `<button class="author-tab ${state.filters.secUid === a.sec_uid ? 'is-active' : ''}" data-uid="${esc(a.sec_uid)}">${esc(a.nickname)}</button>`
    )
    .join('')

  el.authorScroll.querySelectorAll('.author-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.filters.secUid = btn.dataset.uid || ''
      loadGrid(true)
    })
  })
}

// ── Grid View ──

function coverUrl(post) {
  return post.coverUrl || post.media?.imageUrls?.[0] || ''
}

function gridItemHtml(post) {
  const cover = coverUrl(post)
  const desc = truncate(post.desc || post.caption || post.analysis?.summary || '', 20)
  const badge = post.isImagePost ? `${post.media?.imageUrls?.length || 0} 图` : ''

  return `
    <div class="grid-item" data-post-id="${post.id}">
      ${cover ? `<img class="grid-cover" src="${esc(cover)}" />` : ''}
      ${badge ? `<span class="grid-badge">${esc(badge)}</span>` : ''}
      <div class="grid-info">
        <div class="grid-author">@${esc(post.author?.nickname || '')}</div>
        ${desc ? `<div class="grid-desc">${esc(desc)}</div>` : ''}
      </div>
    </div>
  `
}

function bindGridItems() {
  el.grid.querySelectorAll('.grid-item').forEach((item) => {
    item.addEventListener('click', () => {
      const postId = Number(item.dataset.postId)
      const index = state.posts.findIndex((p) => p.id === postId)
      if (index >= 0) openPlayer(index)
    })
  })
}

async function loadGrid(reset = false) {
  if (state.loading) return

  if (reset) {
    state.page = 1
    state.posts = []
    state.hasMore = true
    el.grid.innerHTML = ''
  } else if (!state.hasMore) {
    return
  }

  state.loading = true
  el.gridLoading.style.display = 'flex'

  const query = new URLSearchParams({
    page: String(state.page),
    pageSize: String(state.pageSize)
  })
  if (state.filters.secUid) query.set('secUid', state.filters.secUid)
  if (state.filters.keyword) query.set('keyword', state.filters.keyword)
  if (state.filters.analyzedOnly) query.set('analyzedOnly', 'true')

  try {
    const payload = await fetchJson(`/api/feed?${query}`)
    state.authors = payload.authors || []
    state.total = payload.total || 0
    state.hasMore = Boolean(payload.hasMore)

    const incoming = Array.isArray(payload.posts) ? payload.posts : []
    const existingIds = new Set(state.posts.map((p) => p.id))
    const addedPosts = []
    if (reset) {
      state.posts = incoming
      addedPosts.push(...incoming)
    } else {
      for (const p of incoming) {
        if (!existingIds.has(p.id)) {
          state.posts.push(p)
          addedPosts.push(p)
        }
      }
    }

    renderAuthors()

    if (state.posts.length === 0 && reset) {
      el.grid.innerHTML = `
        <div class="grid-empty">
          <h2>暂无内容</h2>
          <p>在桌面端下载视频后即可在此浏览</p>
        </div>`
    } else {
      const fragment = document.createElement('div')
      fragment.innerHTML = addedPosts.map(gridItemHtml).join('')
      while (fragment.firstElementChild) el.grid.appendChild(fragment.firstElementChild)
      bindGridItems()
      if (!reset && addedPosts.length > 0 && el.playerView.style.display !== 'none') {
        extendPlayer(addedPosts)
      }
    }

    if (incoming.length > 0) state.page += 1
  } catch (err) {
    if (reset) {
      el.grid.innerHTML = `
        <div class="grid-empty">
          <h2>加载失败</h2>
          <p>${esc(err.message)}</p>
        </div>`
    }
    showToast(err.message || '加载失败')
  } finally {
    state.loading = false
    el.gridLoading.style.display = 'none'
  }
}

// Grid infinite scroll
el.grid.addEventListener('scroll', () => {
  const remaining = el.grid.scrollHeight - el.grid.scrollTop - el.grid.clientHeight
  if (remaining < window.innerHeight && state.hasMore && !state.loading) {
    loadGrid(false)
  }
})

// ── Player View ──

function storyHtml(post, index, total) {
  const cover = coverUrl(post)
  const safeCover = esc(cover)
  const tags = (post.analysis?.tags || []).slice(0, 3)
  const desc = truncate(post.desc || post.caption || post.analysis?.summary || '', 80)
  const date = formatDate(post.createTime)

  const mediaHtml =
    post.media?.type === 'video' && post.media.videoUrl
      ? `<video
        class="story-media js-story-video"
        src="${esc(post.media.videoUrl)}"
        poster="${safeCover}"
        preload="metadata"
        playsinline loop muted
      ></video>
      <div class="story-progress js-story-progress">
        <div class="story-progress-track">
          <div class="story-progress-buffer js-story-buffer"></div>
          <div class="story-progress-fill js-story-fill"></div>
          <div class="story-progress-thumb js-story-thumb"></div>
        </div>
        <div class="story-progress-time js-story-time">0:00 / 0:00</div>
      </div>`
      : `<div class="story-image-stack">
        ${(post.media?.imageUrls || [])
          .map((url, i) => {
            const videoUrl = post.media?.imageVideoUrls?.[i]
            const visible = i === 0 ? 'is-visible' : ''
            if (videoUrl) {
              return `<video class="story-image js-gallery-video ${visible}" src="${esc(videoUrl)}" poster="${esc(url)}" preload="metadata" playsinline loop muted data-image-index="${i}"></video>`
            }
            return `<img class="story-image ${visible}" src="${esc(url)}" alt="" loading="lazy" data-image-index="${i}" />`
          })
          .join('')}
      </div>
      ${post.media?.musicUrl ? `<audio class="js-story-audio" src="${esc(post.media.musicUrl)}" loop></audio>` : ''}`

  const imageCount = post.media?.imageUrls?.length || 0
  const galleryNav =
    post.media?.type === 'images' && imageCount > 1
      ? `<div class="story-gallery-nav">
        <button class="gallery-button" type="button" data-gallery-action="prev">${icons.chevronLeft}</button>
        <button class="gallery-button" type="button" data-gallery-action="next">${icons.chevronRight}</button>
      </div>
      <div class="story-dots">
        ${post.media.imageUrls
          .map(
            (_, i) =>
              `<span class="story-dot ${i === 0 ? 'is-active' : ''}" data-dot-index="${i}"></span>`
          )
          .join('')}
      </div>`
      : ''

  return `
    <article class="story" data-post-id="${post.id}" data-index="${index}"
      data-type="${esc(post.media?.type || 'unknown')}"
      data-image-count="${imageCount}" data-image-index="0">
      <div class="story-bg" style="background-image:url('${safeCover}')"></div>
      <div class="story-media-layer">${mediaHtml}</div>
      <div class="story-overlay"></div>
      <span class="story-counter">${index + 1} / ${total}</span>
      ${galleryNav}
      <div class="story-copy">
        <div class="story-author">@${esc(post.author?.nickname || '未知')}</div>
        ${desc ? `<p class="story-title">${esc(desc)}</p>` : ''}
        <div class="story-tags">
          ${date ? `<span class="story-tag">${esc(date)}</span>` : ''}
          ${tags.map((t) => `<span class="story-tag">#${esc(t)}</span>`).join('')}
        </div>
      </div>
      <aside class="story-rail">
        <button class="rail-button" type="button" data-action="mute" aria-label="静音">
          ${state.globalMuted ? icons.muted : icons.volume}
        </button>
      </aside>
    </article>`
}

function clearImageAutoTimer() {
  if (state.imageAutoTimer) {
    clearInterval(state.imageAutoTimer)
    state.imageAutoTimer = null
  }
}

function startImageAutoTimer(story) {
  clearImageAutoTimer()
  const count = Number(story.dataset.imageCount || 0)
  if (count <= 1) return
  const postId = Number(story.dataset.postId)
  if (state.imageManualOverride.has(postId)) return
  state.imageAutoTimer = setInterval(() => {
    const idx = Number(story.dataset.imageIndex || 0)
    updateImageStory(story, idx + 1)
  }, IMAGE_AUTO_INTERVAL)
}

function pauseAll() {
  el.playerFeed.querySelectorAll('.js-story-video').forEach((v) => v.pause())
  el.playerFeed.querySelectorAll('.js-gallery-video').forEach((v) => v.pause())
  el.playerFeed.querySelectorAll('.js-story-audio').forEach((a) => a.pause())
  clearImageAutoTimer()
}

async function activateStory(story) {
  if (!story) return
  const id = Number(story.dataset.postId)
  if (state.activePostId === id) return
  state.activePostId = id
  pauseAll()
  maybeLoadMoreForPlayer(id)

  const video = story.querySelector('.js-story-video')
  const audio = story.querySelector('.js-story-audio')

  if (video) {
    video.muted = state.globalMuted
    try {
      await video.play()
    } catch {
      state.globalMuted = true
      video.muted = true
      syncMute()
    }
  }
  if (audio && !state.globalMuted) {
    audio.muted = false
    try {
      await audio.play()
    } catch {
      state.globalMuted = true
      audio.muted = true
      syncMute()
    }
  }

  if (story.dataset.type === 'images') {
    const firstGalleryVideo = story.querySelector('.js-gallery-video.is-visible')
    if (firstGalleryVideo) {
      firstGalleryVideo.currentTime = 0
      firstGalleryVideo.play().catch(() => {})
    }
    startImageAutoTimer(story)
  }
}

function syncMute() {
  el.playerFeed.querySelectorAll('[data-action="mute"]').forEach((btn) => {
    btn.innerHTML = state.globalMuted ? icons.muted : icons.volume
  })
}

function updateImageStory(story, nextIndex) {
  const count = Number(story.dataset.imageCount || 0)
  if (count <= 1) return
  let idx = nextIndex
  if (idx < 0) idx = count - 1
  if (idx >= count) idx = 0
  story.dataset.imageIndex = idx
  story.querySelectorAll('[data-image-index]').forEach((img) => {
    const active = Number(img.dataset.imageIndex) === idx
    img.classList.toggle('is-visible', active)
    if (img.tagName === 'VIDEO') {
      if (active) {
        img.currentTime = 0
        img.play().catch(() => {})
      } else {
        img.pause()
      }
    }
  })
  story.querySelectorAll('[data-dot-index]').forEach((dot) => {
    dot.classList.toggle('is-active', Number(dot.dataset.dotIndex) === idx)
  })
}

function bindStories() {
  storyObserver?.disconnect()
  storyObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (visible) void activateStory(visible.target)
    },
    { root: el.playerFeed, threshold: [0.4, 0.7] }
  )

  el.playerFeed.querySelectorAll('.story').forEach((story) => {
    storyObserver.observe(story)

    story.querySelectorAll('[data-gallery-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const delta = btn.dataset.galleryAction === 'next' ? 1 : -1
        const postId = Number(story.dataset.postId)
        state.imageManualOverride.add(postId)
        clearImageAutoTimer()
        updateImageStory(story, Number(story.dataset.imageIndex || 0) + delta)
      })
    })

    story.querySelectorAll('[data-dot-index]').forEach((dot) => {
      dot.addEventListener('click', () => {
        const postId = Number(story.dataset.postId)
        state.imageManualOverride.add(postId)
        clearImageAutoTimer()
        updateImageStory(story, Number(dot.dataset.dotIndex || 0))
      })
    })

    story.querySelector('[data-action="mute"]')?.addEventListener('click', async () => {
      state.globalMuted = !state.globalMuted
      syncMute()
      const active = el.playerFeed.querySelector(`.story[data-post-id="${state.activePostId}"]`)
      if (active) {
        state.activePostId = null
        await activateStory(active)
      }
    })

    const video = story.querySelector('.js-story-video')
    if (video) {
      bindVideoControls(story, video)
    }
  })
}

function bindVideoControls(story, video) {
  const progressEl = story.querySelector('.js-story-progress')
  const trackEl = progressEl?.querySelector('.story-progress-track')
  const fillEl = story.querySelector('.js-story-fill')
  const bufferEl = story.querySelector('.js-story-buffer')
  const thumbEl = story.querySelector('.js-story-thumb')
  const timeEl = story.querySelector('.js-story-time')

  let dragging = false
  let lastErrorTime = 0

  const updateBuffer = () => {
    if (!bufferEl || !video.duration || !Number.isFinite(video.duration)) return
    let bufferedEnd = 0
    for (let i = 0; i < video.buffered.length; i += 1) {
      if (video.buffered.start(i) <= video.currentTime) {
        bufferedEnd = Math.max(bufferedEnd, video.buffered.end(i))
      }
    }
    bufferEl.style.width = `${Math.min(100, (bufferedEnd / video.duration) * 100)}%`
  }

  const updateProgress = () => {
    if (dragging || !video.duration || !Number.isFinite(video.duration)) return
    const pct = (video.currentTime / video.duration) * 100
    if (fillEl) fillEl.style.width = `${pct}%`
    if (thumbEl) thumbEl.style.left = `${pct}%`
    if (timeEl)
      timeEl.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`
    updateBuffer()
  }

  const safeSeek = (target) => {
    if (!video.duration || !Number.isFinite(video.duration)) return
    const clamped = Math.max(0, Math.min(video.duration - 0.05, target))
    try {
      video.currentTime = clamped
    } catch {
      // ignore — error handler below will recover
    }
  }

  const pctFromEvent = (event) => {
    if (!trackEl) return 0
    const rect = trackEl.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  }

  const onPointerMove = (event) => {
    if (!dragging) return
    const pct = pctFromEvent(event)
    if (fillEl) fillEl.style.width = `${pct * 100}%`
    if (thumbEl) thumbEl.style.left = `${pct * 100}%`
    if (timeEl && video.duration) {
      timeEl.textContent = `${formatTime(pct * video.duration)} / ${formatTime(video.duration)}`
    }
  }

  const onPointerUp = (event) => {
    if (!dragging) return
    dragging = false
    progressEl?.classList.remove('is-dragging')
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
    document.removeEventListener('pointercancel', onPointerUp)
    if (video.duration) safeSeek(pctFromEvent(event) * video.duration)
  }

  trackEl?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
    dragging = true
    progressEl?.classList.add('is-dragging')
    onPointerMove(event)
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerUp)
  })

  // Block click events on the progress bar from reaching the video tap-to-pause handler.
  progressEl?.addEventListener('click', (event) => event.stopPropagation())

  video.addEventListener('timeupdate', updateProgress)
  video.addEventListener('durationchange', updateProgress)
  video.addEventListener('progress', updateBuffer)
  video.addEventListener('loadedmetadata', updateProgress)

  video.addEventListener('error', () => {
    const now = Date.now()
    if (now - lastErrorTime < 1500) return
    lastErrorTime = now
    const resumeAt = video.currentTime
    const wasPlaying = !video.paused
    const src = video.src
    video.removeAttribute('src')
    video.load()
    video.src = src
    video.load()
    const onReady = () => {
      video.removeEventListener('loadedmetadata', onReady)
      safeSeek(resumeAt)
      if (wasPlaying) video.play().catch(() => {})
    }
    video.addEventListener('loadedmetadata', onReady)
  })

  video.addEventListener('click', async () => {
    if (video.paused) {
      try {
        await video.play()
      } catch {
        showToast('浏览器阻止了自动播放')
      }
    } else {
      video.pause()
    }
  })
}

function openPlayer(startIndex) {
  state.activePostId = null
  const posts = state.posts
  const total = posts.length

  el.playerFeed.innerHTML = posts.map((p, i) => storyHtml(p, i, total)).join('')
  bindStories()

  el.playerView.style.display = 'flex'
  el.browseView.style.display = 'none'

  // Scroll to the selected story
  requestAnimationFrame(() => {
    const target = el.playerFeed.querySelectorAll('.story')[startIndex]
    if (target) {
      target.scrollIntoView({ behavior: 'instant' })
      void activateStory(target)
    }
  })
}

function extendPlayer(newPosts) {
  if (!newPosts.length) return
  const total = state.posts.length
  el.playerFeed.querySelectorAll('.story').forEach((s, i) => {
    s.dataset.total = total
    const counter = s.querySelector('.story-counter')
    if (counter) counter.textContent = `${i + 1} / ${total}`
  })
  const startIndex = total - newPosts.length
  const fragment = document.createElement('div')
  fragment.innerHTML = newPosts.map((p, i) => storyHtml(p, startIndex + i, total)).join('')
  while (fragment.firstElementChild) el.playerFeed.appendChild(fragment.firstElementChild)
  bindStories()
}

function maybeLoadMoreForPlayer(activeId) {
  if (!state.hasMore || state.loading) return
  const idx = state.posts.findIndex((p) => p.id === activeId)
  if (idx < 0) return
  if (idx >= state.posts.length - 3) loadGrid(false)
}

function closePlayer() {
  pauseAll()
  const lastId = state.activePostId
  state.activePostId = null
  state.imageManualOverride.clear()
  el.playerView.style.display = 'none'
  el.browseView.style.display = 'flex'
  if (lastId != null) {
    requestAnimationFrame(() => {
      const target = el.grid.querySelector(`.grid-item[data-post-id="${lastId}"]`)
      if (!target) return
      target.scrollIntoView({ block: 'center', behavior: 'instant' })
      target.classList.add('is-just-viewed')
      setTimeout(() => target.classList.remove('is-just-viewed'), 1200)
    })
  }
}

el.playerBack.addEventListener('click', closePlayer)

function getActiveVideo() {
  if (state.activePostId == null) return null
  const story = el.playerFeed.querySelector(`.story[data-post-id="${state.activePostId}"]`)
  return story?.querySelector('.js-story-video') ?? null
}

function scrollToSiblingStory(delta) {
  if (state.activePostId == null) return
  const stories = Array.from(el.playerFeed.querySelectorAll('.story'))
  const idx = stories.findIndex((s) => Number(s.dataset.postId) === state.activePostId)
  if (idx < 0) return
  const target = stories[idx + delta]
  if (target) target.scrollIntoView({ behavior: 'smooth' })
}

document.addEventListener('keydown', (event) => {
  if (el.playerView.hidden || el.playerView.style.display === 'none') return
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
    return

  if (event.key === 'Escape') {
    event.preventDefault()
    closePlayer()
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    scrollToSiblingStory(-1)
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    scrollToSiblingStory(1)
    return
  }

  const video = getActiveVideo()
  if (!video) return

  if (event.key === ' ' || event.code === 'Space') {
    event.preventDefault()
    if (video.paused) video.play().catch(() => {})
    else video.pause()
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    if (video.duration) video.currentTime = Math.max(0, video.currentTime - 5)
    return
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    if (video.duration) video.currentTime = Math.min(video.duration - 0.05, video.currentTime + 5)
  }
})

// ── Filters wiring ──

let searchTimer = null

function syncSearchClearVisibility() {
  el.searchClear.hidden = !el.searchInput.value
}

el.searchInput.addEventListener('input', () => {
  syncSearchClearVisibility()
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    state.filters.keyword = el.searchInput.value.trim()
    loadGrid(true)
  }, 280)
})

el.searchClear.addEventListener('click', () => {
  el.searchInput.value = ''
  syncSearchClearVisibility()
  if (state.filters.keyword) {
    state.filters.keyword = ''
    loadGrid(true)
  }
  el.searchInput.focus()
})

el.analyzedToggle.addEventListener('click', () => {
  state.filters.analyzedOnly = !state.filters.analyzedOnly
  el.analyzedToggle.setAttribute('aria-pressed', String(state.filters.analyzedOnly))
  loadGrid(true)
})

// ── Bootstrap ──

async function bootstrap() {
  el.gridLoading.style.display = 'flex'
  try {
    const [, tags] = await Promise.all([fetchJson('/api/info'), fetchJson('/api/tags')])
    state.tags = tags.tags || []
    await loadGrid(true)
  } catch (err) {
    el.grid.innerHTML = `
      <div class="grid-empty">
        <h2>连接失败</h2>
        <p>请确认桌面客户端已启动</p>
      </div>`
  }
}

bootstrap()
