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
  author: null,
  authorSyncTimer: null,
  filters: {
    secUid: '',
    keyword: '',
    analyzedOnly: false
  }
}

const IMAGE_AUTO_INTERVAL = 3000
const MEDIA_WINDOW = 3
const MEDIA_UNMOUNT_MARGIN = 2

const el = {
  browseView: document.getElementById('browseView'),
  playerView: document.getElementById('playerView'),
  playerBack: document.getElementById('playerBack'),
  playerFeed: document.getElementById('playerFeed'),
  authorScroll: document.getElementById('authorScroll'),
  authorPanel: document.getElementById('authorPanel'),
  authorModal: document.getElementById('authorModal'),
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
  play: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm7.4-2c0-.34-.03-.67-.07-1l2.02-1.58-2-3.46-2.39.96a7.3 7.3 0 0 0-1.73-1l-.36-2.52h-4l-.36 2.52c-.62.25-1.2.59-1.73 1l-2.39-.96-2 3.46L3.27 11a7.5 7.5 0 0 0 0 2l-2.02 1.58 2 3.46 2.39-.96c.53.41 1.11.75 1.73 1l.36 2.52h4l.36-2.52c.62-.25 1.2-.59 1.73-1l2.39.96 2-3.46L19.33 13c.04-.33.07-.66.07-1Z"/></svg>',
  close:
    '<svg viewBox="0 0 24 24"><path fill="currentColor" d="m12 10.6 5-5 1.4 1.4-5 5 5 5-1.4 1.4-5-5-5 5L5.6 17l5-5-5-5L7 5.6l5 5Z"/></svg>'
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

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
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
      const uid = btn.dataset.uid || ''
      if (uid) enterAuthor(uid)
      else exitAuthor()
    })
  })
}

// ── Author Page ──

function clearAuthorSyncTimer() {
  if (state.authorSyncTimer) {
    clearInterval(state.authorSyncTimer)
    state.authorSyncTimer = null
  }
}

async function enterAuthor(secUid) {
  if (!secUid) return
  if (el.playerView.style.display === 'flex' && !el.playerView.hidden) closePlayer()
  state.filters.secUid = secUid
  state.filters.keyword = ''
  el.searchInput.value = ''
  syncSearchClearVisibility()
  el.grid.scrollTop = 0
  try {
    state.author = await fetchJson(`/api/author?secUid=${encodeURIComponent(secUid)}`)
  } catch {
    state.author = { secUid, nickname: '', settings: {} }
  }
  renderAuthorPanel()
  loadGrid(true)
}

function exitAuthor() {
  clearAuthorSyncTimer()
  closeAuthorModal()
  state.author = null
  state.filters.secUid = ''
  el.authorPanel.hidden = true
  el.authorPanel.innerHTML = ''
  el.grid.scrollTop = 0
  loadGrid(true)
}

const SYNC_PRESETS = [
  { key: 'off', label: '关闭', cron: '' },
  { key: 'hourly', label: '每小时', cron: '0 * * * *' },
  { key: '6h', label: '每6小时', cron: '0 */6 * * *' },
  { key: '12h', label: '每12小时', cron: '0 */12 * * *' },
  { key: 'daily', label: '每天', cron: '0 3 * * *' },
  { key: 'weekly', label: '每周', cron: '0 3 * * 1' },
  { key: 'custom', label: '自定义', cron: null }
]

function isAuthorSyncing(a) {
  return Boolean(a?.syncing) || a?.syncStatus === 'syncing'
}

function detectSyncPreset(settings) {
  if (!settings?.autoSync || !settings?.syncCron) return 'off'
  const found = SYNC_PRESETS.find((p) => p.cron && p.cron === settings.syncCron)
  return found ? found.key : 'custom'
}

function renderAuthorPanel() {
  const a = state.author
  if (!a) {
    el.authorPanel.hidden = true
    return
  }
  const syncing = isAuthorSyncing(a)
  const initial = (a.nickname || '?').trim().charAt(0) || '?'

  el.authorPanel.innerHTML = `
    <div class="author-hero">
      <div class="author-hero-avatar">${esc(initial)}</div>
      <div class="author-hero-main">
        <div class="author-hero-name">@${esc(a.nickname || '未知作者')}</div>
        ${a.signature ? `<div class="author-hero-sign">${esc(truncate(a.signature, 70))}</div>` : ''}
        <div class="author-hero-stats">
          <span><b>${Number(a.awemeCount || 0)}</b> 作品</span>
          <span class="author-hero-dot">·</span>
          <span class="js-author-downloaded"><b>${state.total || 0}</b> 已下载</span>
          ${syncing ? '<span class="author-hero-syncing">同步中…</span>' : ''}
        </div>
      </div>
      <div class="author-hero-actions">
        <button class="author-icon-btn" type="button" data-author-action="settings" aria-label="设置">${icons.gear}</button>
        <button class="author-icon-btn" type="button" data-author-action="exit" aria-label="返回全部">${icons.close}</button>
      </div>
    </div>
  `
  el.authorPanel.hidden = false
  el.authorPanel.querySelector('[data-author-action="exit"]')?.addEventListener('click', exitAuthor)
  el.authorPanel
    .querySelector('[data-author-action="settings"]')
    ?.addEventListener('click', openAuthorModal)

  if (syncing) startAuthorSyncPolling()
  else clearAuthorSyncTimer()

  if (!el.authorModal.hidden) refreshModalSyncState()
}

function openAuthorModal() {
  const a = state.author
  if (!a) return
  const s = a.settings || {}
  const activePreset = detectSyncPreset(s)
  const syncing = isAuthorSyncing(a)
  const lastSync = a.lastSyncAt
    ? formatDate(new Date(a.lastSyncAt * 1000).toISOString())
    : '尚未同步'

  el.authorModal.innerHTML = `
    <div class="author-modal-backdrop" data-modal-close></div>
    <div class="author-modal-card">
      <div class="author-modal-head">
        <h3>@${esc(a.nickname || '作者')} · 设置</h3>
        <button class="author-icon-btn" type="button" data-modal-close aria-label="关闭">${icons.close}</button>
      </div>
      <div class="author-modal-body">
        <label class="author-field">
          <span>下载数量上限 <small>0 = 用全局设置</small></span>
          <input class="js-m-max" type="number" min="0" inputmode="numeric" value="${Number(s.maxDownloadCount || 0)}" />
        </label>
        <label class="author-field">
          <span>备注</span>
          <input class="js-m-remark" type="text" maxlength="200" value="${esc(s.remark || '')}" placeholder="给作者加个备注" />
        </label>
        <div class="author-field">
          <span>同步计划</span>
          <div class="sync-presets js-m-presets">
            ${SYNC_PRESETS.map(
              (p) =>
                `<button type="button" class="sync-chip ${p.key === activePreset ? 'is-active' : ''}" data-preset="${p.key}">${esc(p.label)}</button>`
            ).join('')}
          </div>
          <input class="js-m-cron" type="text" maxlength="120" placeholder="自定义 cron，如 0 3 * * *" value="${esc(s.syncCron || '')}" ${activePreset === 'custom' ? '' : 'hidden'} />
        </div>
      </div>
      <div class="author-modal-actions">
        <button class="author-btn author-btn-sync js-m-sync ${syncing ? 'is-syncing' : ''}" type="button" data-modal-action="sync" ${syncing ? 'disabled' : ''}>${syncing ? '同步中…' : '立即同步下载'}</button>
        <button class="author-btn author-btn-save" type="button" data-modal-action="save">保存设置</button>
      </div>
      <div class="author-modal-status js-m-status">上次同步 ${esc(lastSync)}</div>
    </div>
  `
  el.authorModal.hidden = false
  bindAuthorModal()
}

function closeAuthorModal() {
  el.authorModal.hidden = true
  el.authorModal.innerHTML = ''
}

function bindAuthorModal() {
  el.authorModal.querySelectorAll('[data-modal-close]').forEach((node) => {
    node.addEventListener('click', closeAuthorModal)
  })
  const cronInput = el.authorModal.querySelector('.js-m-cron')
  el.authorModal.querySelectorAll('.sync-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      el.authorModal.querySelectorAll('.sync-chip').forEach((c) => c.classList.remove('is-active'))
      chip.classList.add('is-active')
      const isCustom = chip.dataset.preset === 'custom'
      if (cronInput) {
        cronInput.hidden = !isCustom
        if (isCustom) cronInput.focus()
      }
    })
  })
  el.authorModal
    .querySelector('[data-modal-action="save"]')
    ?.addEventListener('click', saveAuthorSettings)
  el.authorModal
    .querySelector('[data-modal-action="sync"]')
    ?.addEventListener('click', triggerAuthorSync)
}

function refreshModalSyncState() {
  const a = state.author
  if (!a || el.authorModal.hidden) return
  const syncing = isAuthorSyncing(a)
  const btn = el.authorModal.querySelector('.js-m-sync')
  if (btn) {
    btn.classList.toggle('is-syncing', syncing)
    btn.disabled = syncing
    btn.textContent = syncing ? '同步中…' : '立即同步下载'
  }
  const status = el.authorModal.querySelector('.js-m-status')
  if (status) {
    const lastSync = a.lastSyncAt
      ? formatDate(new Date(a.lastSyncAt * 1000).toISOString())
      : '尚未同步'
    status.textContent = `上次同步 ${lastSync}`
  }
}

async function saveAuthorSettings() {
  if (!state.author) return
  const maxEl = el.authorModal.querySelector('.js-m-max')
  const remarkEl = el.authorModal.querySelector('.js-m-remark')
  const cronEl = el.authorModal.querySelector('.js-m-cron')
  const activeChip = el.authorModal.querySelector('.sync-chip.is-active')
  const presetKey = activeChip?.dataset.preset || 'off'

  let autoSync = false
  let syncCron = ''
  if (presetKey === 'custom') {
    syncCron = cronEl?.value?.trim() ?? ''
    if (!syncCron) {
      showToast('请填写自定义 cron 表达式')
      return
    }
    autoSync = true
  } else if (presetKey !== 'off') {
    const preset = SYNC_PRESETS.find((p) => p.key === presetKey)
    syncCron = preset?.cron ?? ''
    autoSync = true
  }

  const payload = {
    secUid: state.author.secUid,
    maxDownloadCount: Math.max(0, Math.floor(Number(maxEl?.value) || 0)),
    remark: remarkEl?.value ?? '',
    autoSync,
    syncCron
  }
  try {
    state.author = await postJson('/api/author/settings', payload)
    renderAuthorPanel()
    closeAuthorModal()
    showToast('已保存设置')
  } catch (err) {
    showToast(err.message || '保存失败')
  }
}

async function triggerAuthorSync() {
  if (!state.author) return
  try {
    const res = await postJson('/api/author/sync', { secUid: state.author.secUid })
    if (res.started) showToast('已开始同步下载')
    else if (res.syncing) showToast('该作者正在同步中')
    state.author = { ...state.author, syncing: true, syncStatus: 'syncing' }
    renderAuthorPanel()
  } catch (err) {
    showToast(err.message || '同步失败')
  }
}

function startAuthorSyncPolling() {
  clearAuthorSyncTimer()
  state.authorSyncTimer = setInterval(async () => {
    if (!state.author) {
      clearAuthorSyncTimer()
      return
    }
    try {
      const next = await fetchJson(`/api/author?secUid=${encodeURIComponent(state.author.secUid)}`)
      const wasSyncing = isAuthorSyncing(state.author)
      state.author = next
      const nowSyncing = isAuthorSyncing(next)
      renderAuthorPanel()
      if (wasSyncing && !nowSyncing) {
        showToast('同步完成')
        loadGrid(true)
      }
    } catch {
      // 网络抖动忽略，下次轮询再试
    }
  }, 4000)
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
        <div class="grid-author" data-author-uid="${esc(post.author?.secUid || '')}">@${esc(post.author?.nickname || '')}</div>
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
    const authorEl = item.querySelector('.grid-author[data-author-uid]')
    if (authorEl && authorEl.dataset.authorUid) {
      authorEl.addEventListener('click', (event) => {
        event.stopPropagation()
        enterAuthor(authorEl.dataset.authorUid)
      })
    }
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

    if (state.author && !el.authorPanel.hidden) {
      const dl = el.authorPanel.querySelector('.js-author-downloaded')
      if (dl) dl.textContent = `已下载 ${state.total || 0}`
    }

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

function mediaInnerHtml(post) {
  if (post.media?.type === 'video' && post.media.videoUrl) {
    const safeCover = esc(coverUrl(post))
    return `<video
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
  }
  return `<div class="story-image-stack">
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
}

function storyHtml(post, index, total) {
  const cover = coverUrl(post)
  const safeCover = esc(cover)
  const tags = (post.analysis?.tags || []).slice(0, 3)
  const desc = truncate(post.desc || post.caption || post.analysis?.summary || '', 80)
  const date = formatDate(post.createTime)

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
      <div class="story-media-layer"></div>
      <div class="story-overlay"></div>
      <span class="story-counter">${index + 1} / ${total}</span>
      ${galleryNav}
      <div class="story-copy">
        <div class="story-author" data-author-uid="${esc(post.author?.secUid || '')}">@${esc(post.author?.nickname || '未知')}</div>
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

function mountStoryMedia(story) {
  if (story.dataset.mediaMounted === '1') return
  const layer = story.querySelector('.story-media-layer')
  if (!layer) return
  const postId = Number(story.dataset.postId)
  const post = state.posts.find((p) => p.id === postId)
  if (!post) return
  layer.innerHTML = mediaInnerHtml(post)
  story.dataset.mediaMounted = '1'

  if (story.dataset.type === 'images') {
    const idx = Number(story.dataset.imageIndex || 0)
    if (idx > 0) updateImageStory(story, idx)
  }

  const video = story.querySelector('.js-story-video')
  if (video) bindVideoControls(story, video)
}

function unmountStoryMedia(story) {
  if (story.dataset.mediaMounted !== '1') return
  const layer = story.querySelector('.story-media-layer')
  if (!layer) return
  layer.querySelectorAll('video, audio').forEach((m) => {
    try {
      m.pause()
    } catch {
      // ignore
    }
    try {
      m.removeAttribute('src')
      m.load()
    } catch {
      // ignore
    }
  })
  layer.innerHTML = ''
  delete story.dataset.mediaMounted
}

function updateMediaWindow(activeIdx) {
  const stories = Array.from(el.playerFeed.querySelectorAll('.story'))
  stories.forEach((s, i) => {
    const dist = Math.abs(i - activeIdx)
    if (dist <= MEDIA_WINDOW) mountStoryMedia(s)
    else if (dist > MEDIA_WINDOW + MEDIA_UNMOUNT_MARGIN) unmountStoryMedia(s)
  })
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

  const stories = Array.from(el.playerFeed.querySelectorAll('.story'))
  const activeIdx = stories.indexOf(story)
  if (activeIdx >= 0) updateMediaWindow(activeIdx)

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

async function applyMuteToActive() {
  const story = el.playerFeed.querySelector(`.story[data-post-id="${state.activePostId}"]`)
  if (!story) return
  const video = story.querySelector('.js-story-video')
  const audio = story.querySelector('.js-story-audio')
  if (video) {
    video.muted = state.globalMuted
    if (video.paused) {
      try {
        await video.play()
      } catch {
        state.globalMuted = true
        video.muted = true
        syncMute()
        return
      }
    }
  }
  if (audio) {
    if (state.globalMuted) {
      audio.pause()
    } else {
      audio.muted = false
      try {
        await audio.play()
      } catch {
        state.globalMuted = true
        audio.muted = true
        syncMute()
      }
    }
  }
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
    if (story.dataset.bound === '1') return
    story.dataset.bound = '1'

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

    story.querySelector('[data-action="mute"]')?.addEventListener('click', () => {
      state.globalMuted = !state.globalMuted
      syncMute()
      void applyMuteToActive()
    })

    const authorEl = story.querySelector('.story-author[data-author-uid]')
    if (authorEl && authorEl.dataset.authorUid) {
      authorEl.addEventListener('click', (event) => {
        event.stopPropagation()
        enterAuthor(authorEl.dataset.authorUid)
      })
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

  // 长按 2 倍速播放（仿抖音移动端）：按住视频 350ms 进入 2x，松手恢复。
  const SPEED_HOLD_MS = 350
  const SPEED_MOVE_TOLERANCE = 10
  let holdTimer = null
  let speedActive = false
  let speedEndedAt = 0
  let startX = 0
  let startY = 0
  let speedBadge = null

  const showSpeedBadge = () => {
    if (!speedBadge) {
      speedBadge = document.createElement('div')
      speedBadge.className = 'story-speed-badge'
      const icon = document.createElement('span')
      icon.className = 'story-speed-badge-icon'
      icon.textContent = '▶▶'
      speedBadge.append(icon, '2倍速播放中')
      story.appendChild(speedBadge)
    }
    void speedBadge.offsetWidth
    speedBadge.classList.add('is-visible')
  }

  const enterSpeed = () => {
    holdTimer = null
    if (speedActive) return
    speedActive = true
    video.playbackRate = 2
    if (video.paused) video.play().catch(() => {})
    showSpeedBadge()
  }

  const exitSpeed = () => {
    if (holdTimer) {
      clearTimeout(holdTimer)
      holdTimer = null
    }
    if (!speedActive) return
    speedActive = false
    video.playbackRate = 1
    speedBadge?.classList.remove('is-visible')
    speedEndedAt = Date.now() // 松手随后触发的 click 在此后短时间内被忽略，避免误暂停
  }

  video.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    startX = event.clientX
    startY = event.clientY
    if (holdTimer) clearTimeout(holdTimer)
    holdTimer = setTimeout(enterSpeed, SPEED_HOLD_MS)
  })

  video.addEventListener('pointermove', (event) => {
    if (!holdTimer || speedActive) return
    if (
      Math.abs(event.clientX - startX) > SPEED_MOVE_TOLERANCE ||
      Math.abs(event.clientY - startY) > SPEED_MOVE_TOLERANCE
    ) {
      // 判定为滑动（切换视频/拖动），取消长按
      clearTimeout(holdTimer)
      holdTimer = null
    }
  })

  video.addEventListener('pointerup', exitSpeed)
  video.addEventListener('pointercancel', exitSpeed)
  video.addEventListener('pointerleave', exitSpeed)
  // 阻止长按时弹出原生菜单（iOS 存储视频 / 桌面右键），以免打断倍速手势
  video.addEventListener('contextmenu', (event) => event.preventDefault())

  video.addEventListener('click', async () => {
    if (Date.now() - speedEndedAt < 300) return // 忽略长按松手后误触的暂停
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

  el.playerView.hidden = false
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
  el.playerView.hidden = true
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
  if (!el.authorModal.hidden && event.key === 'Escape') {
    event.preventDefault()
    closeAuthorModal()
    return
  }
  if (el.playerView.style.display !== 'flex') return
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

  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const activeStory =
      state.activePostId != null
        ? el.playerFeed.querySelector(`.story[data-post-id="${state.activePostId}"]`)
        : null
    if (activeStory && activeStory.dataset.type === 'images') {
      event.preventDefault()
      const delta = event.key === 'ArrowRight' ? 1 : -1
      state.imageManualOverride.add(Number(activeStory.dataset.postId))
      clearImageAutoTimer()
      updateImageStory(activeStory, Number(activeStory.dataset.imageIndex || 0) + delta)
      return
    }
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
