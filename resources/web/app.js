const state = {
  info: null,
  tags: [],
  authors: [],
  posts: [],
  page: 1,
  pageSize: 8,
  total: 0,
  hasMore: true,
  loading: false,
  globalMuted: true,
  activePostId: null,
  filters: {
    secUid: '',
    tags: [],
    keyword: '',
    analyzedOnly: false
  }
}

const elements = {
  feed: document.getElementById('feed'),
  serverMeta: document.getElementById('serverMeta'),
  feedMeta: document.getElementById('feedMeta'),
  filtersPanel: document.getElementById('filtersPanel'),
  filtersToggle: document.getElementById('filtersToggle'),
  keywordInput: document.getElementById('keywordInput'),
  analyzedOnly: document.getElementById('analyzedOnly'),
  authorChips: document.getElementById('authorChips'),
  tagChips: document.getElementById('tagChips'),
  resetFilters: document.getElementById('resetFilters'),
  toast: document.getElementById('toast')
}

let storyObserver = null
let searchTimer = null
let toastTimer = null

const icons = {
  muted:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 9v6h4l5 4V5L9 9H5Zm11.59 3 2.7 2.7-1.42 1.42-2.7-2.7-2.7 2.7-1.42-1.42 2.7-2.7-2.7-2.7 1.42-1.42 2.7 2.7 2.7-2.7 1.42 1.42-2.7 2.7Z"/></svg>',
  volume:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 9v6h4l5 4V5L9 9H5Zm11.5 3a4.5 4.5 0 0 0-2.14-3.83v7.66A4.5 4.5 0 0 0 16.5 12Zm-2.14-8.24v2.06a8 8 0 0 1 0 12.36v2.06c3.45-1.35 5.89-4.71 5.89-8.24s-2.44-6.89-5.89-8.24Z"/></svg>',
  chevronLeft:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m14.7 6.3-1.4-1.4L6.2 12l7.1 7.1 1.4-1.4L9 12l5.7-5.7Z"/></svg>',
  chevronRight:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m9.3 17.7 1.4 1.4 7.1-7.1-7.1-7.1-1.4 1.4L15 12l-5.7 5.7Z"/></svg>'
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function truncate(value, maxLength = 72) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function headlineFor(post) {
  const candidates = [
    post.analysis?.summary,
    post.caption,
    post.desc,
    post.author?.nickname
  ].filter(Boolean)

  return truncate(candidates[0] || '未命名片段', 22)
}

function formatDate(value) {
  if (!value) return '未记录时间'
  if (/^\d{8}/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  }
  return value.slice(0, 10)
}

function showToast(message) {
  elements.toast.textContent = message
  elements.toast.classList.add('is-visible')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove('is-visible')
  }, 2200)
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error || `Request failed: ${response.status}`)
  }
  return response.json()
}

function setStatus() {
  const lanUrl =
    state.info?.urls?.find((url) => !url.includes('127.0.0.1') && !url.includes('localhost')) ||
    state.info?.origin

  elements.serverMeta.textContent = lanUrl
    ? `在线端口 ${state.info.port} · ${lanUrl}`
    : '服务未启动'
  elements.feedMeta.textContent = state.loading
    ? '加载中...'
    : `已加载 ${state.posts.length} / ${state.total} 条`
}

function renderAuthorChips() {
  const items = [{ sec_uid: '', nickname: '全部作者' }, ...state.authors]
  elements.authorChips.innerHTML = items
    .map(
      (author) => `
        <button
          class="chip ${state.filters.secUid === author.sec_uid ? 'is-active' : ''}"
          type="button"
          data-author="${escapeHtml(author.sec_uid)}"
        >
          ${escapeHtml(author.nickname)}
        </button>
      `
    )
    .join('')

  elements.authorChips.querySelectorAll('[data-author]').forEach((button) => {
    button.addEventListener('click', () => {
      state.filters.secUid = button.dataset.author || ''
      loadFeed(true)
    })
  })
}

function renderTagChips() {
  const items = ['全部标签', ...state.tags]
  elements.tagChips.innerHTML = items
    .map((tag) => {
      const active =
        tag === '全部标签'
          ? state.filters.tags.length === 0
          : state.filters.tags.includes(tag)
      return `
        <button
          class="chip ${active ? 'is-active' : ''}"
          type="button"
          data-tag="${escapeHtml(tag)}"
        >
          ${escapeHtml(tag)}
        </button>
      `
    })
    .join('')

  elements.tagChips.querySelectorAll('[data-tag]').forEach((button) => {
    button.addEventListener('click', () => {
      const tag = button.dataset.tag || ''
      if (tag === '全部标签') {
        state.filters.tags = []
      } else if (state.filters.tags.includes(tag)) {
        state.filters.tags = state.filters.tags.filter((item) => item !== tag)
      } else {
        state.filters.tags = [...state.filters.tags, tag]
      }
      loadFeed(true)
    })
  })
}

function storyMarkup(post, index) {
  const cover =
    post.coverUrl ||
    post.media?.imageUrls?.[0] ||
    post.media?.videoUrl ||
    ''
  const safeCover = escapeHtml(cover)
  const tags = (post.analysis?.tags || []).slice(0, 4)
  const summary = headlineFor(post)
  const desc = truncate(post.desc || post.caption || post.analysis?.summary || '', 84)
  const contentLevel =
    post.analysis?.contentLevel === null || post.analysis?.contentLevel === undefined
      ? '未评级'
      : `L${post.analysis.contentLevel}`

  const mediaHtml =
    post.media?.type === 'video' && post.media.videoUrl
      ? `
          <video
            class="story-media js-story-video"
            src="${escapeHtml(post.media.videoUrl)}"
            poster="${safeCover}"
            preload="metadata"
            playsinline
            loop
            muted
          ></video>
        `
      : `
          <div class="story-image-stack">
            ${(post.media?.imageUrls || [])
              .map(
                (url, imageIndex) => `
                  <img
                    class="story-image ${imageIndex === 0 ? 'is-visible' : ''}"
                    src="${escapeHtml(url)}"
                    alt="${escapeHtml(summary)}"
                    loading="lazy"
                    data-image-index="${imageIndex}"
                  />
                `
              )
              .join('')}
          </div>
          ${
            post.media?.musicUrl
              ? `<audio class="js-story-audio" src="${escapeHtml(post.media.musicUrl)}" loop></audio>`
              : ''
          }
        `

  const galleryNav =
    post.media?.type === 'images' && (post.media.imageUrls?.length || 0) > 1
      ? `
          <div class="story-gallery-nav">
            <button class="gallery-button" type="button" data-gallery-action="prev">${icons.chevronLeft}</button>
            <button class="gallery-button" type="button" data-gallery-action="next">${icons.chevronRight}</button>
          </div>
          <div class="story-dots">
            ${post.media.imageUrls
              .map(
                (_url, imageIndex) => `
                  <span class="story-dot ${imageIndex === 0 ? 'is-active' : ''}" data-dot-index="${imageIndex}"></span>
                `
              )
              .join('')}
          </div>
        `
      : ''

  return `
    <article
      class="story"
      data-post-id="${post.id}"
      data-index="${index}"
      data-type="${escapeHtml(post.media?.type || 'unknown')}"
      data-image-count="${post.media?.imageUrls?.length || 0}"
      data-image-index="0"
      style="--story-background: url('${safeCover}') center / cover no-repeat;"
    >
      <div class="story-shell">
        <div class="story-phone">
          <div class="story-media-layer">${mediaHtml}</div>
          <div class="story-overlay"></div>
          <div class="story-topline">
            <span class="story-badge">${post.isImagePost ? 'IMAGE STORY' : 'VIDEO STORY'}</span>
            <span class="story-index">${String(index + 1).padStart(2, '0')} / ${Math.max(state.total, state.posts.length)}</span>
          </div>
          ${galleryNav}
          <div class="story-copy">
            <div class="story-author">@${escapeHtml(post.author?.nickname || '未知作者')}</div>
            <p class="story-summary">${escapeHtml(summary)}</p>
            <p class="story-desc">${escapeHtml(desc || '暂无描述')}</p>
            <div class="story-meta">
              <span class="story-stat">${escapeHtml(contentLevel)}</span>
              <span class="story-stat">${escapeHtml(formatDate(post.createTime))}</span>
              ${tags.map((tag) => `<span class="story-chip">#${escapeHtml(tag)}</span>`).join('')}
            </div>
          </div>
          <aside class="story-rail">
            <button class="rail-button" type="button" data-action="mute" aria-label="切换静音">
              ${state.globalMuted ? icons.muted : icons.volume}
            </button>
            <div class="rail-caption">${post.isImagePost ? '图集' : '视频'}<br />${escapeHtml(contentLevel)}</div>
          </aside>
        </div>
      </div>
    </article>
  `
}

function renderPlaceholder(title, message, buttonText = '重试') {
  elements.feed.innerHTML = `
    <section class="placeholder">
      <div class="placeholder-card">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <button id="retryButton" class="ghost-button" type="button">${escapeHtml(buttonText)}</button>
      </div>
    </section>
  `
  document.getElementById('retryButton')?.addEventListener('click', () => loadFeed(true))
}

function renderLoadingState() {
  elements.feed.innerHTML = `
    <section class="loading-card">
      <div>
        <div class="spinner"></div>
        <div class="status-pill">正在加载视频流...</div>
      </div>
    </section>
  `
}

function syncMuteButtons() {
  elements.feed.querySelectorAll('[data-action="mute"]').forEach((button) => {
    button.innerHTML = state.globalMuted ? icons.muted : icons.volume
  })
}

function updateImageStory(story, nextIndex) {
  const imageCount = Number.parseInt(story.dataset.imageCount || '0', 10)
  if (imageCount <= 1) return

  let targetIndex = nextIndex
  if (targetIndex < 0) targetIndex = imageCount - 1
  if (targetIndex >= imageCount) targetIndex = 0

  story.dataset.imageIndex = String(targetIndex)
  story.querySelectorAll('[data-image-index]').forEach((image) => {
    image.classList.toggle('is-visible', Number(image.dataset.imageIndex) === targetIndex)
  })
  story.querySelectorAll('[data-dot-index]').forEach((dot) => {
    dot.classList.toggle('is-active', Number(dot.dataset.dotIndex) === targetIndex)
  })
}

function pauseAllStories() {
  elements.feed.querySelectorAll('.js-story-video').forEach((video) => {
    video.pause()
  })
  elements.feed.querySelectorAll('.js-story-audio').forEach((audio) => {
    audio.pause()
  })
}

async function activateStory(story) {
  if (!story) return

  const nextActiveId = Number(story.dataset.postId)
  if (state.activePostId === nextActiveId) {
    syncMuteButtons()
    return
  }

  state.activePostId = nextActiveId
  elements.feed.querySelectorAll('.story').forEach((item) => {
    item.classList.toggle('is-active', item === story)
  })
  pauseAllStories()

  const video = story.querySelector('.js-story-video')
  const audio = story.querySelector('.js-story-audio')

  if (video) {
    video.muted = state.globalMuted
    try {
      await video.play()
    } catch {
      state.globalMuted = true
      video.muted = true
      syncMuteButtons()
    }
  }

  if (audio) {
    audio.muted = state.globalMuted
    if (!state.globalMuted) {
      try {
        await audio.play()
      } catch {
        state.globalMuted = true
        audio.muted = true
        syncMuteButtons()
      }
    }
  }

  const storyIndex = Number.parseInt(story.dataset.index || '0', 10)
  if (storyIndex >= state.posts.length - 2 && state.hasMore) {
    loadFeed(false)
  }
}

function bindStoryInteractions(scope) {
  scope.querySelectorAll('.story').forEach((story) => {
    storyObserver?.observe(story)

    story.querySelectorAll('[data-gallery-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const delta = button.dataset.galleryAction === 'next' ? 1 : -1
        const currentIndex = Number.parseInt(story.dataset.imageIndex || '0', 10)
        updateImageStory(story, currentIndex + delta)
      })
    })

    story.querySelector('[data-action="mute"]')?.addEventListener('click', async () => {
      state.globalMuted = !state.globalMuted
      syncMuteButtons()
      const activeStory = elements.feed.querySelector(`.story[data-post-id="${state.activePostId}"]`)
      if (activeStory) {
        await activateStory(activeStory)
      }
    })

    story.querySelector('.js-story-video')?.addEventListener('click', async (event) => {
      const video = event.currentTarget
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
  })
}

function rebuildObserver() {
  storyObserver?.disconnect()
  storyObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0]
      if (visible) {
        void activateStory(visible.target)
      }
    },
    {
      root: elements.feed,
      threshold: [0.35, 0.6, 0.82]
    }
  )
}

function appendStories(posts, reset) {
  if (reset) {
    if (posts.length === 0) {
      renderPlaceholder('没有可看的内容', '先在桌面端下载并勾选展示用户，这里就会自动出现视频。')
      return
    }

    rebuildObserver()
    elements.feed.innerHTML = posts.map((post, index) => storyMarkup(post, index)).join('')
    bindStoryInteractions(elements.feed)
    requestAnimationFrame(() => {
      const firstStory = elements.feed.querySelector('.story')
      if (firstStory) {
        void activateStory(firstStory)
      }
    })
    return
  }

  const wrapper = document.createElement('div')
  const startIndex = state.posts.length - posts.length
  wrapper.innerHTML = posts
    .map((post, index) => storyMarkup(post, startIndex + index))
    .join('')

  bindStoryInteractions(wrapper)
  while (wrapper.firstElementChild) {
    elements.feed.appendChild(wrapper.firstElementChild)
  }
}

async function loadFeed(reset = false) {
  if (state.loading) return

  if (reset) {
    state.page = 1
    state.posts = []
    state.hasMore = true
    state.activePostId = null
    renderLoadingState()
  } else if (!state.hasMore) {
    return
  }

  state.loading = true
  setStatus()

  const query = new URLSearchParams({
    page: String(state.page),
    pageSize: String(state.pageSize)
  })

  if (state.filters.secUid) query.set('secUid', state.filters.secUid)
  if (state.filters.keyword.trim()) query.set('keyword', state.filters.keyword.trim())
  if (state.filters.analyzedOnly) query.set('analyzedOnly', 'true')
  state.filters.tags.forEach((tag) => query.append('tag', tag))

  try {
    const payload = await fetchJson(`/api/feed?${query.toString()}`)
    state.authors = payload.authors || []
    state.total = payload.total || 0
    state.hasMore = Boolean(payload.hasMore)

    const incomingPosts = Array.isArray(payload.posts) ? payload.posts : []
    if (reset) {
      state.posts = incomingPosts
    } else {
      const existingIds = new Set(state.posts.map((post) => post.id))
      for (const post of incomingPosts) {
        if (!existingIds.has(post.id)) {
          state.posts.push(post)
        }
      }
    }

    renderAuthorChips()
    renderTagChips()
    appendStories(incomingPosts, reset)

    if (incomingPosts.length > 0) {
      state.page += 1
    }
  } catch (error) {
    renderPlaceholder('加载失败', error.message || '视频流服务暂时不可用')
    showToast(error.message || '加载失败')
  } finally {
    state.loading = false
    setStatus()
  }
}

async function bootstrap() {
  renderLoadingState()

  try {
    const [info, tags] = await Promise.all([fetchJson('/api/info'), fetchJson('/api/tags')])
    state.info = info
    state.tags = tags.tags || []
    setStatus()
    renderTagChips()
    await loadFeed(true)
  } catch (error) {
    renderPlaceholder('网页端未就绪', error.message || '请确认桌面客户端已经完全启动')
  }
}

elements.filtersToggle.addEventListener('click', () => {
  elements.filtersPanel.classList.toggle('is-open')
})

elements.keywordInput.addEventListener('input', (event) => {
  const input = event.currentTarget
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    state.filters.keyword = input.value
    loadFeed(true)
  }, 260)
})

elements.analyzedOnly.addEventListener('change', (event) => {
  state.filters.analyzedOnly = event.currentTarget.checked
  loadFeed(true)
})

elements.resetFilters.addEventListener('click', () => {
  state.filters = {
    secUid: '',
    tags: [],
    keyword: '',
    analyzedOnly: false
  }
  elements.keywordInput.value = ''
  elements.analyzedOnly.checked = false
  loadFeed(true)
})

elements.feed.addEventListener('scroll', () => {
  const remaining = elements.feed.scrollHeight - elements.feed.scrollTop - elements.feed.clientHeight
  if (remaining < window.innerHeight * 1.5 && state.hasMore && !state.loading) {
    loadFeed(false)
  }
})

window.addEventListener('resize', () => {
  if (window.innerWidth > 720) {
    elements.filtersPanel.classList.add('is-open')
  }
})

bootstrap()
