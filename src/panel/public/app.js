/* eslint-disable @typescript-eslint/explicit-function-return-type */
const view = document.querySelector('#view')
const login = document.querySelector('#login')
const shell = document.querySelector('#shell')
const modal = document.querySelector('#modal')
const toast = document.querySelector('#toast')
const crumbEl = document.querySelector('#crumb')
const statusEl = document.querySelector('#topStatus')
const navEl = document.querySelector('#sideNav')

const state = {
  nodes: [],
  keys: [],
  node: null,
  tags: [],
  tagsLoaded: false,
  loadedNodeId: '',
  users: [],
  tasks: [],
  query: { page: 1, keyword: '', secUid: '', tag: '', analyzedOnly: false },
  live: { sync: {}, download: {} }
}

let events = null
let pollTimer = 0
let searchTimer = 0
let postsGen = 0
let modalDismiss = null

const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

const I = {
  nodes: svg(
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>'
  ),
  posts: svg(
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.6" fill="currentColor" stroke="none"/><path d="m21 15-3.2-3.2a1.8 1.8 0 0 0-2.6 0L6 21"/>'
  ),
  users: svg(
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'
  ),
  tasks: svg(
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'
  )
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function tone(seed) {
  let n = 0
  const text = String(seed || '')
  for (let i = 0; i < text.length; i += 1) n = (n * 31 + text.charCodeAt(i)) >>> 0
  return (n % 6) + 1
}

function initials(name) {
  const text = String(name || '').trim()
  return text ? text.slice(0, 1).toUpperCase() : '·'
}

function n(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatExact(value) {
  if (!value) return '—'
  const date = new Date(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatAgo(value) {
  if (!value) return '尚未连接'
  const delta = Date.now() - value
  if (delta < 15_000) return '刚刚'
  if (delta < 60_000) return `${Math.floor(delta / 1000)} 秒前`
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)} 天前`
  return formatExact(value)
}

function platformText(value) {
  if (value === 'darwin') return 'macOS'
  if (value === 'win32') return 'Windows'
  if (value === 'linux') return 'Linux'
  return value || ''
}

function statusBadge(online) {
  return `<span class="badge ${online ? 'ok' : 'off'}"><i></i><span>${online ? '在线' : '离线'}</span></span>`
}

function loginBadge(info) {
  if (!info?.loggedIn) return '<span class="badge warn"><i></i><span>未登录抖音</span></span>'
  const who = info.uniqueId ? `抖音号 ${info.uniqueId}` : info.nickname || '已登录抖音'
  return `<span class="badge ok"><i></i><span>${esc(who)}</span></span>`
}

function syncBadge(user, live) {
  if (live?.message)
    return `<span class="badge info"><i></i><span>${esc(live.message)}</span></span>`
  if (user.syncing || user.syncStatus === 'syncing') {
    return '<span class="badge info"><i></i><span>同步中</span></span>'
  }
  if (user.syncStatus === 'error') return '<span class="badge err"><i></i><span>失败</span></span>'
  return '<span class="badge off"><i></i><span>空闲</span></span>'
}

function taskBadge(task) {
  if (task.running || task.status === 'running') {
    return '<span class="badge info"><i></i><span>进行中</span></span>'
  }
  if (task.status === 'failed') return '<span class="badge err"><i></i><span>失败</span></span>'
  if (task.status === 'completed') return '<span class="badge ok"><i></i><span>已完成</span></span>'
  return '<span class="badge off"><i></i><span>待命</span></span>'
}

function loadingHtml(text) {
  return `<div class="loading"><span class="bar" aria-hidden="true"></span>${esc(text)}</div>`
}

function emptyHtml(title, body) {
  return `<div class="empty"><strong>${esc(title)}</strong><p>${esc(body)}</p></div>`
}

function navItem(href, icon, label, active) {
  return `<a class="nav-item${active ? ' active' : ''}" href="${href}">${icon}<span>${label}</span></a>`
}

function setChrome(crumb, status, nav) {
  crumbEl.innerHTML = crumb
  statusEl.innerHTML = status
  navEl.innerHTML = nav
}

function showToast(message) {
  toast.hidden = false
  toast.textContent = message
  clearTimeout(showToast.timer)
  showToast.timer = setTimeout(() => {
    toast.hidden = true
  }, 2800)
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {})
  headers.set('X-Panel', '1')
  if (options.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...options, headers })
  if (response.status === 401 && path !== '/api/login') {
    showLogin()
    throw new Error('请先登录')
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || '请求失败')
  return data
}

async function rpc(nodeId, method, params) {
  const data = await api(`/api/nodes/${encodeURIComponent(nodeId)}/rpc`, {
    method: 'POST',
    body: JSON.stringify({ method, params: params || {} })
  })
  return data.result
}

function route() {
  const parts = location.hash.replace(/^#/, '').split('/').filter(Boolean)
  if (parts[0] === 'n' && parts[1]) {
    const tab = parts[2] === 'users' || parts[2] === 'tasks' ? parts[2] : 'posts'
    return { name: 'node', id: decodeURIComponent(parts[1]), tab }
  }
  return { name: 'list' }
}

function mediaUrl(nodeId, ref) {
  if (!ref) return ''
  if (ref.kind === 'remote' && /^https:\/\//.test(ref.url || '')) return ref.url
  if (ref.kind === 'file' && ref.token) {
    return `/api/nodes/${encodeURIComponent(nodeId)}/media?token=${encodeURIComponent(ref.token)}`
  }
  return ''
}

function showLogin() {
  shell.hidden = true
  login.hidden = false
  stopLive()
  document.title = '登录 · dYm 管理控制台'
  document.querySelector('#tokenInput')?.focus()
}

function showShell() {
  login.hidden = true
  shell.hidden = false
}

async function boot() {
  try {
    await api('/api/me')
    showShell()
    await render()
  } catch {
    showLogin()
  }
}

document.querySelector('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault()
  const error = document.querySelector('#loginError')
  const button = event.currentTarget.querySelector('button[type="submit"]')
  error.hidden = true
  button.disabled = true
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ token: document.querySelector('#tokenInput').value })
    })
    showShell()
    if (location.hash !== '#/' && location.hash !== '') location.hash = '#/'
    else await render()
  } catch (err) {
    error.hidden = false
    error.textContent = err.message
  } finally {
    button.disabled = false
  }
})

document.querySelector('#toggleToken').addEventListener('click', () => {
  const input = document.querySelector('#tokenInput')
  const hidden = input.type === 'password'
  input.type = hidden ? 'text' : 'password'
  document.querySelector('#toggleToken').textContent = hidden ? '隐藏' : '显示'
  input.focus()
})

document.querySelector('#logoutButton').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {})
  showLogin()
})

window.addEventListener('hashchange', () => {
  state.query.page = 1
  void render()
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modal.hidden) closeModal()
})

async function render() {
  clearTimeout(searchTimer)
  postsGen += 1
  const current = route()
  stopLive()
  try {
    if (current.name === 'list') await renderList()
    else await renderNode(current.id, current.tab)
  } catch (error) {
    setChrome('<strong>管理控制台</strong>', '', navHome(false))
    view.innerHTML = `<div class="page"><section class="surface">${emptyHtml('没有完成这次读取', error.message)}</section></div>`
    showToast(error.message)
  }
}

function navHome(active) {
  return `<p class="nav-label">总览</p>${navItem('#/', I.nodes, '客户端', active)}`
}

function navNode(node, tab) {
  const id = encodeURIComponent(node.id)
  return `${navHome(false)}
    <p class="nav-label">当前客户端</p>
    <div class="nav-current"><strong>${esc(node.name)}</strong><span>${node.online ? '在线' : '离线'}</span></div>
    ${navItem(`#/n/${id}/posts`, I.posts, '作品', tab === 'posts')}
    ${navItem(`#/n/${id}/users`, I.users, '用户', tab === 'users')}
    ${navItem(`#/n/${id}/tasks`, I.tasks, '下载任务', tab === 'tasks')}`
}

async function renderList() {
  const [nodes, keys] = await Promise.all([api('/api/nodes'), api('/api/keys')])
  state.nodes = nodes.nodes
  state.keys = keys.keys
  state.node = null
  document.title = '客户端 · dYm 管理控制台'
  const online = state.nodes.filter((node) => node.online).length
  const users = state.nodes.reduce((total, node) => total + (node.counts?.users || 0), 0)
  const posts = state.nodes.reduce((total, node) => total + (node.counts?.posts || 0), 0)
  setChrome(
    '<strong>客户端</strong>',
    `${n(online)} 在线 · ${n(state.nodes.length)} 台`,
    navHome(true)
  )
  const rows = state.nodes
    .map((node) => {
      const counts = node.counts || {}
      const host = [node.hostname || '未知主机', platformText(node.platform)]
        .filter(Boolean)
        .join(' · ')
      return `<tr>
        <td><a class="entity" href="#/n/${encodeURIComponent(node.id)}/posts">
          <span class="mono t${tone(node.name)}">${esc(initials(node.name))}</span>
          <span><strong>${esc(node.name)}</strong><span class="sub">${node.keyPrefix ? `密钥 ${esc(node.keyPrefix)}…` : '未关联密钥'}</span></span>
        </a></td>
        <td>${statusBadge(node.online)}</td>
        <td class="clip" title="${esc(host)}">${esc(host)}</td>
        <td>${node.version ? `<span class="code">${esc(node.version)}</span>` : '<span class="muted">—</span>'}</td>
        <td>${loginBadge(node.login)}</td>
        <td class="num">${n(counts.users)}</td>
        <td class="num">${n(counts.posts)}</td>
        <td title="${esc(formatExact(node.lastSeen))}">${esc(formatAgo(node.lastSeen))}</td>
        <td class="actions"><a class="btn" href="#/n/${encodeURIComponent(node.id)}/posts">进入</a></td>
      </tr>`
    })
    .join('')
  const keyRows = state.keys
    .map((key) => {
      const linked = state.nodes.find((node) => node.id === key.nodeId)
      return `<tr>
        <td><strong>${esc(key.name)}</strong></td>
        <td><span class="code">${esc(key.prefix)}…</span></td>
        <td>${esc(linked?.name || '—')}</td>
        <td title="${esc(formatExact(key.createdAt))}">${esc(formatAgo(key.createdAt))}</td>
        <td>${statusBadge(key.online)}</td>
        <td class="actions"><button class="text danger-text" type="button" data-revoke="${esc(key.id)}">吊销</button></td>
      </tr>`
    })
    .join('')
  view.innerHTML = `<div class="page">
    <header class="page-head">
      <div>
        <h1>客户端</h1>
        <p class="lede">先选择一台，再管理这一台的作品、用户和下载任务。各台数据不会混在一起。</p>
      </div>
    </header>
    <section class="metrics" aria-label="概览">
      <article class="metric"><span>在线</span><strong>${n(online)}</strong><em>当前保持连接</em></article>
      <article class="metric"><span>离线</span><strong>${n(state.nodes.length - online)}</strong><em>等待重新连入</em></article>
      <article class="metric"><span>用户</span><strong>${n(users)}</strong><em>各客户端上次上报</em></article>
      <article class="metric"><span>作品</span><strong>${n(posts)}</strong><em>各客户端上次上报</em></article>
    </section>
    <section class="surface">
      <div class="surface-head">
        <div>
          <h2>全部客户端</h2>
          <p>点进一台之后，后续操作只作用于这一台。</p>
        </div>
        <span class="count-chip">${n(state.nodes.length)} 台</span>
      </div>
      ${
        rows
          ? `<div class="table-scroll"><table class="data">
              <thead><tr>
                <th scope="col">客户端</th><th scope="col">状态</th><th scope="col">主机</th><th scope="col">版本</th>
                <th scope="col">抖音</th><th scope="col" class="num">用户</th><th scope="col" class="num">作品</th>
                <th scope="col">最近心跳</th><th scope="col" class="actions">操作</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table></div>`
          : emptyHtml('还没有客户端', '在下方签发密钥，填进对应电脑的 dYm。客户端会自己连到这里。')
      }
    </section>
    <section class="surface">
      <div class="surface-head">
        <div>
          <h2>节点密钥</h2>
          <p>一把密钥对应一台电脑。完整内容只在签发时显示一次。</p>
        </div>
        <span class="count-chip">${n(state.keys.length)} 把</span>
      </div>
      <form id="keyForm" class="composer">
        <label class="field grow">名称
          <input id="keyName" maxlength="64" placeholder="例如：客厅电脑" autocomplete="off" />
        </label>
        <button class="primary" type="submit">签发密钥</button>
      </form>
      <div class="table-scroll"><table class="data">
        <thead><tr>
          <th scope="col">名称</th><th scope="col">前缀</th><th scope="col">客户端</th>
          <th scope="col">签发</th><th scope="col">状态</th><th scope="col" class="actions">操作</th>
        </tr></thead>
        <tbody>${keyRows || `<tr><td colspan="6">${emptyHtml('还没有密钥', '签发后把完整密钥填进那台 dYm。')}</td></tr>`}</tbody>
      </table></div>
    </section>
  </div>`
  document.querySelector('#keyForm').addEventListener('submit', onIssueKey)
  view.querySelectorAll('[data-revoke]').forEach((button) => {
    button.addEventListener('click', () => onRevoke(button.dataset.revoke))
  })
}

async function onIssueKey(event) {
  event.preventDefault()
  const button = event.currentTarget.querySelector('button[type="submit"]')
  const name = document.querySelector('#keyName').value
  button.disabled = true
  try {
    const issued = await api('/api/keys', { method: 'POST', body: JSON.stringify({ name }) })
    openModal(`<div class="dialog-pad">
      <div>
        <p class="eyebrow">节点密钥</p>
        <h2>密钥已签发</h2>
      </div>
      <p class="warn-text">关闭这个窗口后不能再查看完整密钥。请立刻复制到对应电脑的 dYm 设置里。</p>
      <pre class="key-box" id="fullKey"></pre>
      <div class="dialog-actions">
        <button class="ghost" id="closeModal" type="button">关闭</button>
        <button class="primary" id="copyKey" type="button">复制密钥</button>
      </div>
    </div>`)
    const box = document.querySelector('#fullKey')
    box.textContent = issued.key
    document.querySelector('#copyKey').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(issued.key)
        showToast('已复制')
      } catch {
        showToast('复制失败，请手动选中密钥')
      }
    })
    document.querySelector('#closeModal').addEventListener('click', closeModal)
    await renderList()
  } catch (error) {
    showToast(error.message)
  } finally {
    button.disabled = false
  }
}

async function onRevoke(id) {
  const key = state.keys.find((item) => item.id === id)
  const ok = await ask({
    title: '吊销密钥',
    body: `吊销「${key?.name || '这把密钥'}」后，使用它的电脑会断开，且不能再用这把密钥连入。`,
    confirm: '吊销',
    danger: true
  })
  if (!ok) return
  try {
    await api(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' })
    showToast('已吊销')
    await renderList()
  } catch (error) {
    showToast(error.message)
  }
}

async function renderNode(id, tab) {
  if (state.loadedNodeId !== id) {
    state.loadedNodeId = id
    state.tags = []
    state.tagsLoaded = false
    state.users = []
    state.live = { sync: {}, download: {} }
    state.query = { page: 1, keyword: '', secUid: '', tag: '', analyzedOnly: false }
  }
  let node = state.nodes.find((item) => item.id === id) || null
  try {
    const data = await api(`/api/nodes/${encodeURIComponent(id)}`)
    node = data.node
  } catch (error) {
    setChrome(
      `<a href="#/">客户端</a><span class="sep">/</span><strong>未找到</strong>`,
      '',
      navHome(false)
    )
    view.innerHTML = `<div class="page"><section class="surface"><div class="empty"><strong>找不到这台客户端</strong><p>${esc(error.message)}</p><a class="btn" href="#/">返回列表</a></div></section></div>`
    return
  }
  state.node = node
  document.title = `${node.name} · dYm 管理控制台`
  const counts = node.counts || {}
  const meta = [node.hostname, platformText(node.platform), node.version]
    .filter(Boolean)
    .join(' · ')
  setChrome(
    `<a href="#/">客户端</a><span class="sep">/</span><strong>${esc(node.name)}</strong>`,
    node.keyPrefix ? `密钥 ${esc(node.keyPrefix)}…` : '',
    navNode(node, tab)
  )
  const tabs = [
    ['posts', '作品'],
    ['users', '用户'],
    ['tasks', '下载任务']
  ]
    .map(
      ([key, label]) =>
        `<a class="${tab === key ? 'active' : ''}" href="#/n/${encodeURIComponent(id)}/${key}">${label}</a>`
    )
    .join('')
  view.innerHTML = `<div class="page">
    <header class="page-head">
      <div>
        <h1>${esc(node.name)}</h1>
        <p class="lede">${esc(meta || '还没有上报主机信息')}</p>
      </div>
      <div class="head-side">
        <span id="nodeLive">${statusBadge(node.online)}</span>
        ${loginBadge(node.login)}
      </div>
    </header>
    <p class="note">抖音登录需要在这台电脑的 dYm 窗口里完成。这里只显示状态，不会读取 Cookie。</p>
    <section class="metrics" aria-label="这台客户端">
      <article class="metric"><span>用户</span><strong>${n(counts.users)}</strong><em>上次上报</em></article>
      <article class="metric"><span>作品</span><strong>${n(counts.posts)}</strong><em>上次上报</em></article>
      <article class="metric"><span>下载任务</span><strong>${n(counts.runningTasks)}</strong><em>进行中</em></article>
      <article class="metric"><span>同步</span><strong>${n(counts.syncingUsers)}</strong><em>正在同步的用户</em></article>
    </section>
    <nav class="tabs">${tabs}</nav>
    <div id="pane" data-live="${node.online ? '1' : '0'}">${node.online ? loadingHtml('正在读取') : `<section class="surface">${emptyHtml('客户端离线', `暂时不能浏览或下发操作。上次上报：用户 ${n(counts.users)}，作品 ${n(counts.posts)}。`)}</section>`}</div>
  </div>`
  const pane = document.querySelector('#pane')
  if (node.online) {
    try {
      if (tab === 'users') await renderUsers(pane, node)
      else if (tab === 'tasks') await renderTasks(pane, node)
      else await renderPosts(pane, node)
    } catch (error) {
      pane.innerHTML = `<section class="surface">${emptyHtml('读取失败', error.message)}</section>`
    }
  }
  listen(node.id, tab)
}

function paintOnline(online) {
  const live = document.querySelector('#nodeLive')
  if (live) live.innerHTML = statusBadge(online)
  const side = document.querySelector('.nav-current span')
  if (side) side.textContent = online ? '在线' : '离线'
  const pane = document.querySelector('#pane')
  let banner = document.querySelector('#offlineBanner')
  if (!online && pane?.dataset.live === '1') {
    if (!banner) {
      banner = document.createElement('p')
      banner.id = 'offlineBanner'
      banner.className = 'note warn'
      banner.textContent = '这台客户端刚刚离线。已打开的内容暂时不能继续操作。'
      pane.before(banner)
    }
  } else {
    banner?.remove()
  }
}

function listen(nodeId, tab) {
  stopLive()
  events = new EventSource(`/api/nodes/${encodeURIComponent(nodeId)}/events`)
  events.addEventListener('sync', (event) => {
    const data = JSON.parse(event.data)
    state.live.sync[data.userId] = data
    if (tab === 'users' && document.activeElement?.closest('form, input, select') == null) {
      const cell = document.querySelector(`[data-sync="${data.userId}"]`)
      if (cell) cell.innerHTML = syncBadge({ id: data.userId, syncing: true }, data)
    }
  })
  events.addEventListener('download', (event) => {
    const data = JSON.parse(event.data)
    state.live.download[data.taskId] = data
    const cell = document.querySelector(`[data-task="${data.taskId}"]`)
    if (cell) cell.textContent = data.message || data.status || ''
  })
  events.addEventListener('snapshot', () => paintOnline(true))
  pollTimer = window.setInterval(async () => {
    if (route().id !== nodeId) return
    const data = await api(`/api/nodes/${encodeURIComponent(nodeId)}`).catch(() => null)
    if (!data || route().id !== nodeId) return
    const wasOnline = Boolean(state.node?.online)
    state.node = data.node
    paintOnline(data.node.online)
    if (!wasOnline && data.node.online) void renderNode(nodeId, tab)
  }, 8000)
}

function stopLive() {
  events?.close()
  events = null
  clearInterval(pollTimer)
  pollTimer = 0
}

function bindMedia(root) {
  root.querySelectorAll('img[data-src]').forEach((img) => {
    img.addEventListener('error', () => {
      const fallback = document.createElement('span')
      fallback.className = img.classList.contains('avatar') ? 'avatar-fallback' : 'cover-fallback'
      fallback.textContent = img.dataset.fallback || ''
      img.replaceWith(fallback)
    })
    img.src = img.dataset.src
  })
}

async function renderPosts(pane, node, refocus = false) {
  const gen = ++postsGen
  if (!state.tagsLoaded) {
    const tags = await rpc(node.id, 'tags.list').catch(() => ({ tags: [] }))
    if (gen !== postsGen || !pane.isConnected) return
    state.tags = tags.tags || []
    state.tagsLoaded = true
  }
  const query = state.query
  const result = await rpc(node.id, 'posts.list', query)
  if (gen !== postsGen || !pane.isConnected) return
  const authors = (result.authors || [])
    .map(
      (author) =>
        `<option value="${esc(author.secUid)}" ${author.secUid === query.secUid ? 'selected' : ''}>${esc(author.nickname)}</option>`
    )
    .join('')
  const tags = state.tags
    .map(
      (tag) =>
        `<option value="${esc(tag)}" ${tag === query.tag ? 'selected' : ''}>${esc(tag)}</option>`
    )
    .join('')
  const cards = (result.posts || [])
    .map((post, index) => {
      const cover = mediaUrl(node.id, post.cover)
      const seed = post.author?.nickname || post.awemeId
      const label = post.desc || post.caption || post.awemeId
      const chips = (post.analysis?.tags || [])
        .slice(0, 2)
        .map((tag) => `<em>${esc(tag)}</em>`)
        .join('')
      return `<button class="asset t${tone(seed)}" type="button" data-post="${index}" aria-label="${esc(label)}">
        <span class="asset-media">
          ${
            cover
              ? `<img alt="" data-src="${esc(cover)}" data-fallback="${esc(initials(seed))}" />`
              : `<span class="cover-fallback">${esc(initials(seed))}</span>`
          }
          ${post.isImagePost ? '<span class="flag">图文</span>' : ''}
        </span>
        <span class="asset-meta">
          <strong>${esc(label)}</strong>
          <span class="sub">${esc(post.author?.nickname || '未知作者')}</span>
          ${chips ? `<span class="chips">${chips}</span>` : ''}
        </span>
      </button>`
    })
    .join('')
  const pages = Math.max(1, Math.ceil((result.total || 0) / (result.pageSize || 1)))
  pane.innerHTML = `<div class="stack">
    <section class="surface"><div class="filters">
      <label class="field grow">关键词
        <input id="keyword" placeholder="描述、作者或标签" value="${esc(query.keyword)}" autocomplete="off" />
      </label>
      <label class="field">作者
        <select id="author"><option value="">全部作者</option>${authors}</select>
      </label>
      <label class="field">标签
        <select id="tag"><option value="">全部标签</option>${tags}</select>
      </label>
      <label class="checkline"><input id="analyzed" type="checkbox" ${query.analyzedOnly ? 'checked' : ''} />只看已分析</label>
    </div></section>
    ${
      cards
        ? `<div class="library">${cards}</div>`
        : `<section class="surface">${emptyHtml('没有符合条件的作品', '换一个关键词、作者或标签后再看。')}</section>`
    }
    <div class="pager">
      <span class="muted">第 ${n(result.page)} / ${n(pages)} 页 · 共 ${n(result.total)} 个</span>
      <div class="pager-actions">
        <button class="ghost" id="prev" type="button" ${query.page <= 1 ? 'disabled' : ''}>上一页</button>
        <button class="ghost" id="next" type="button" ${result.hasMore ? '' : 'disabled'}>下一页</button>
      </div>
    </div>
  </div>`
  bindMedia(pane)
  const keyword = pane.querySelector('#keyword')
  keyword.addEventListener('input', (event) => {
    state.query.keyword = event.target.value
    state.query.page = 1
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      void renderPosts(pane, node, true).catch((error) => showToast(error.message))
    }, 300)
  })
  if (refocus) {
    keyword.focus()
    const end = keyword.value.length
    keyword.setSelectionRange(end, end)
  }
  pane.querySelector('#author').addEventListener('change', (event) => {
    state.query.secUid = event.target.value
    state.query.page = 1
    void renderPosts(pane, node).catch((error) => showToast(error.message))
  })
  pane.querySelector('#tag').addEventListener('change', (event) => {
    state.query.tag = event.target.value
    state.query.page = 1
    void renderPosts(pane, node).catch((error) => showToast(error.message))
  })
  pane.querySelector('#analyzed').addEventListener('change', (event) => {
    state.query.analyzedOnly = event.target.checked
    state.query.page = 1
    void renderPosts(pane, node).catch((error) => showToast(error.message))
  })
  pane.querySelector('#prev').addEventListener('click', () => {
    state.query.page = Math.max(1, state.query.page - 1)
    void renderPosts(pane, node).catch((error) => showToast(error.message))
  })
  pane.querySelector('#next').addEventListener('click', () => {
    state.query.page += 1
    void renderPosts(pane, node).catch((error) => showToast(error.message))
  })
  pane.querySelectorAll('[data-post]').forEach((button) => {
    button.addEventListener('click', () =>
      openPost(node.id, result.posts[Number(button.dataset.post)])
    )
  })
}

function openPost(nodeId, post) {
  if (!post) return
  const video = mediaUrl(nodeId, post.video)
  const cover = mediaUrl(nodeId, post.cover)
  const images = (post.images || []).map((image) => mediaUrl(nodeId, image)).filter(Boolean)
  const body = post.isImagePost
    ? images.map((src) => `<img alt="" data-src="${esc(src)}" />`).join('') ||
      (cover ? `<img alt="" data-src="${esc(cover)}" />` : '<p class="muted">没有可显示的图片</p>')
    : video
      ? `<video controls autoplay data-src="${esc(video)}"></video>`
      : cover
        ? `<img alt="" data-src="${esc(cover)}" />`
        : '<p class="muted">没有可播放的文件</p>'
  const tags = (post.analysis?.tags || []).map((tag) => `<em>${esc(tag)}</em>`).join('')
  openModal(
    `<div class="viewer">
      <div class="viewer-stage">${body}</div>
      <div class="viewer-copy">
        <div class="spread">
          <div>
            <p class="eyebrow">${esc(post.author?.nickname || '未知作者')}</p>
            <h2>${esc(post.desc || post.caption || post.awemeId)}</h2>
          </div>
          <button class="ghost" id="closeModal" type="button">关闭</button>
        </div>
        ${post.analysis?.summary ? `<p>${esc(post.analysis.summary)}</p>` : '<p class="muted">还没有分析摘要</p>'}
        ${tags ? `<div class="chips">${tags}</div>` : ''}
        <p class="muted">作品 ${esc(post.awemeId)}</p>
      </div>
    </div>`,
    { wide: true }
  )
  modal.querySelectorAll('[data-src]').forEach((el) => {
    el.addEventListener('error', () => {
      const note = document.createElement('p')
      note.className = 'muted'
      note.textContent = '文件无法显示'
      el.replaceWith(note)
    })
    el.src = el.dataset.src
  })
  document.querySelector('#closeModal').addEventListener('click', closeModal)
}

async function renderUsers(pane, node) {
  if (!node.online) return
  const result = await rpc(node.id, 'users.list')
  if (!pane.isConnected) return
  state.users = result.users || []
  const rows = state.users
    .map((user) => {
      const live = state.live.sync[user.id]
      const avatar = mediaUrl(node.id, user.avatar)
      const meta = [user.uniqueId ? `@${user.uniqueId}` : '', user.remark]
        .filter(Boolean)
        .join(' · ')
      return `<tr>
        <td><div class="who">
          ${
            avatar
              ? `<img class="avatar" alt="" data-src="${esc(avatar)}" data-fallback="${esc(initials(user.nickname))}" />`
              : `<span class="avatar-fallback">${esc(initials(user.nickname))}</span>`
          }
          <div><strong>${esc(user.nickname || '未命名')}</strong><div class="sub">${esc(meta || '—')}</div></div>
        </div></td>
        <td class="num">${n(user.downloadedCount)} / ${n(user.awemeCount)}</td>
        <td class="num">${n(user.followerCount)}</td>
        <td data-sync="${user.id}">${syncBadge(user, live)}</td>
        <td>${user.autoSync ? `<strong>开</strong><div class="sub">${esc(user.syncCron || '未设 Cron')}</div>` : '<span class="muted">关</span>'}</td>
        <td class="actions"><div class="row-actions">
          <button class="text" type="button" data-sync-start="${user.id}">同步</button>
          <button class="text" type="button" data-refresh="${user.id}">刷新</button>
          <button class="text" type="button" data-edit="${user.id}">设置</button>
          <button class="text danger-text" type="button" data-delete="${user.id}">删除</button>
        </div></td>
      </tr>`
    })
    .join('')
  pane.innerHTML = `<section class="surface">
    <form id="addUser" class="composer">
      <label class="field grow">添加用户
        <input id="userUrl" placeholder="粘贴用户主页或作品链接" autocomplete="off" />
      </label>
      <button class="primary" type="submit">添加</button>
    </form>
    ${
      rows
        ? `<div class="table-scroll"><table class="data">
            <thead><tr>
              <th scope="col">用户</th><th scope="col" class="num">已下载 / 作品</th><th scope="col" class="num">粉丝</th>
              <th scope="col">同步</th><th scope="col">自动同步</th><th scope="col" class="actions">操作</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table></div>`
        : emptyHtml('还没有用户', '粘贴用户主页或作品链接，添加到这台客户端。')
    }
  </section>`
  bindMedia(pane)
  pane.querySelector('#addUser').addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = event.currentTarget.querySelector('button[type="submit"]')
    const url = document.querySelector('#userUrl').value.trim()
    if (!url) {
      showToast('请粘贴用户主页或作品链接')
      return
    }
    button.disabled = true
    button.textContent = '正在添加'
    try {
      await rpc(node.id, 'users.add', { url })
      showToast('已添加')
      await renderUsers(pane, node)
    } catch (error) {
      showToast(error.message)
      button.disabled = false
      button.textContent = '添加'
    }
  })
  bindUserActions(pane, node)
}

function bindUserActions(pane, node) {
  pane.querySelectorAll('[data-sync-start]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true
      try {
        await rpc(node.id, 'users.sync', { id: Number(button.dataset.syncStart) })
        showToast('已开始同步')
      } catch (error) {
        showToast(error.message)
      } finally {
        button.disabled = false
      }
    })
  })
  pane.querySelectorAll('[data-refresh]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true
      try {
        await rpc(node.id, 'users.refresh', { id: Number(button.dataset.refresh) })
        showToast('资料已刷新')
        await renderUsers(pane, node)
      } catch (error) {
        showToast(error.message)
        button.disabled = false
      }
    })
  })
  pane.querySelectorAll('[data-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      const user = state.users.find((item) => item.id === Number(button.dataset.edit))
      if (user) openUserSettings(node, user, pane)
    })
  })
  pane.querySelectorAll('[data-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      const user = state.users.find((item) => item.id === Number(button.dataset.delete))
      const remove = await ask({
        title: '删除用户',
        body: `从这台客户端的列表里删除「${user?.nickname || '这个用户'}」？`,
        confirm: '继续',
        danger: true
      })
      if (!remove) return
      const deleteFiles = await ask({
        title: '已下载的文件',
        body: '可以同时删除这台电脑上已经下载的文件。选择保留文件则只从列表移除。',
        confirm: '删除文件',
        cancel: '保留文件',
        danger: true
      })
      try {
        await rpc(node.id, 'users.delete', { id: Number(button.dataset.delete), deleteFiles })
        showToast(deleteFiles ? '已删除用户和文件' : '已从列表移除')
        await renderUsers(pane, node)
      } catch (error) {
        showToast(error.message)
      }
    })
  })
}

function openUserSettings(node, user, pane) {
  openModal(`<form id="userSettings" class="dialog-pad">
    <div class="spread">
      <div>
        <p class="eyebrow">用户设置</p>
        <h2>${esc(user.nickname || '未命名')}</h2>
      </div>
      <button class="ghost" id="closeModal" type="button">关闭</button>
    </div>
    <label class="field">备注<input name="remark" maxlength="200" value="${esc(user.remark)}" /></label>
    <label class="field">单用户下载上限<input name="maxDownloadCount" type="number" min="0" value="${Number(user.maxDownloadCount) || 0}" />
      <span class="muted">0 表示使用这台客户端的全局设置。</span>
    </label>
    <label class="field">自动同步 Cron<input name="syncCron" value="${esc(user.syncCron)}" placeholder="留空表示不定时，例如 0 8 * * *" /></label>
    <div class="stack">
      <label class="checkline"><input name="showInHome" type="checkbox" ${user.showInHome ? 'checked' : ''} />在桌面端首页显示</label>
      <label class="checkline"><input name="autoSync" type="checkbox" ${user.autoSync ? 'checked' : ''} />启用自动同步</label>
    </div>
    <div class="dialog-actions"><button class="primary" type="submit">保存</button></div>
  </form>`)
  document.querySelector('#closeModal').addEventListener('click', closeModal)
  document.querySelector('#userSettings').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const button = form.querySelector('button[type="submit"]')
    button.disabled = true
    try {
      await rpc(node.id, 'users.updateSettings', {
        id: user.id,
        remark: form.remark.value,
        maxDownloadCount: Number(form.maxDownloadCount.value),
        syncCron: form.syncCron.value,
        showInHome: form.showInHome.checked,
        autoSync: form.autoSync.checked
      })
      closeModal()
      showToast('已保存')
      await renderUsers(pane, node)
    } catch (error) {
      showToast(error.message)
      button.disabled = false
    }
  })
}

async function renderTasks(pane, node) {
  if (!node.online) return
  const [tasks, users] = await Promise.all([
    rpc(node.id, 'tasks.list'),
    state.users.length ? Promise.resolve({ users: state.users }) : rpc(node.id, 'users.list')
  ])
  if (!pane.isConnected) return
  state.tasks = tasks.tasks || []
  state.users = users.users || state.users
  const options = state.users
    .map(
      (user) =>
        `<label><input type="checkbox" value="${user.id}" />${esc(user.nickname || '未命名')}</label>`
    )
    .join('')
  const rows = state.tasks
    .map((task) => {
      const live = state.live.download[task.id] || task.progress
      const names = (task.users || []).map((user) => user.nickname).join('、')
      const progress = live?.message || `${n(task.downloadedVideos)} / ${n(task.totalVideos)}`
      return `<tr>
        <td><strong>${esc(task.name)}</strong><div class="sub">${esc(names || '未指定用户')}</div></td>
        <td>${taskBadge(task)}</td>
        <td data-task="${task.id}">${esc(progress)}</td>
        <td class="actions"><div class="row-actions">
          <button class="text" type="button" data-start="${task.id}">开始</button>
          <button class="text" type="button" data-stop="${task.id}">停止</button>
          <button class="text danger-text" type="button" data-remove="${task.id}">删除</button>
        </div></td>
      </tr>`
    })
    .join('')
  pane.innerHTML = `<div class="stack">
    <form id="createTask" class="surface composer-block">
      <div class="surface-head" style="padding:0;border:0">
        <div>
          <h2>新建下载任务</h2>
          <p>任务只在这台客户端上创建和执行。</p>
        </div>
      </div>
      <label class="field">任务名称<input name="name" maxlength="80" required placeholder="例如：本周更新" /></label>
      <div class="field">
        <span class="field-label"><span>选择用户</span><span id="picked" class="muted">已选 0 人</span></span>
        <div class="pick-list">${options || '<div class="empty">先到用户页添加用户</div>'}</div>
      </div>
      <div class="dialog-actions"><button class="primary" type="submit">创建任务</button></div>
    </form>
    <section class="surface">
      <div class="surface-head">
        <h2>任务列表</h2>
        <span class="count-chip">${n(state.tasks.length)} 个</span>
      </div>
      ${
        rows
          ? `<div class="table-scroll"><table class="data">
              <thead><tr>
                <th scope="col">任务</th><th scope="col">状态</th><th scope="col">进度</th><th scope="col" class="actions">操作</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table></div>`
          : emptyHtml('还没有下载任务', '选好用户并填写名称后即可创建。')
      }
    </section>
  </div>`
  const form = pane.querySelector('#createTask')
  const picked = form.querySelector('#picked')
  form.addEventListener('change', () => {
    const count = form.querySelectorAll('input[type="checkbox"]:checked').length
    picked.textContent = `已选 ${count} 人`
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const userIds = [...form.querySelectorAll('input[type="checkbox"]:checked')].map((input) =>
      Number(input.value)
    )
    if (!userIds.length) {
      showToast('请选择至少一个用户')
      return
    }
    const button = form.querySelector('button[type="submit"]')
    button.disabled = true
    try {
      await rpc(node.id, 'tasks.create', { name: form.name.value, userIds })
      showToast('已创建')
      await renderTasks(pane, node)
    } catch (error) {
      showToast(error.message)
      button.disabled = false
    }
  })
  pane.querySelectorAll('[data-start]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await rpc(node.id, 'tasks.start', { id: Number(button.dataset.start) })
        showToast('已开始')
      } catch (error) {
        showToast(error.message)
      }
    })
  })
  pane.querySelectorAll('[data-stop]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await rpc(node.id, 'tasks.stop', { id: Number(button.dataset.stop) })
        showToast('已请求停止')
      } catch (error) {
        showToast(error.message)
      }
    })
  })
  pane.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', async () => {
      const task = state.tasks.find((item) => item.id === Number(button.dataset.remove))
      const ok = await ask({
        title: '删除下载任务',
        body: `删除「${task?.name || '这个任务'}」？已经下载的文件会保留。`,
        confirm: '删除',
        danger: true
      })
      if (!ok) return
      try {
        await rpc(node.id, 'tasks.delete', { id: Number(button.dataset.remove) })
        showToast('已删除')
        await renderTasks(pane, node)
      } catch (error) {
        showToast(error.message)
      }
    })
  })
}

function openModal(html, options = {}) {
  modal.removeEventListener('click', onModalBackdrop)
  modalDismiss = options.onDismiss || null
  modal.hidden = false
  modal.innerHTML = `<div class="dialog${options.wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`
  modal.addEventListener('click', onModalBackdrop)
}

function onModalBackdrop(event) {
  if (event.target === modal) closeModal()
}

function closeModal() {
  const dismiss = modalDismiss
  modalDismiss = null
  modal.hidden = true
  modal.innerHTML = ''
  modal.removeEventListener('click', onModalBackdrop)
  dismiss?.()
}

function ask({ title, body, confirm, cancel = '取消', danger = false }) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      closeModal()
      resolve(value)
    }
    openModal(
      `<div class="dialog-pad">
        <div>
          <p class="eyebrow">请确认</p>
          <h2>${esc(title)}</h2>
        </div>
        <p class="lede">${esc(body)}</p>
        <div class="dialog-actions">
          <button class="ghost" id="askCancel" type="button">${esc(cancel)}</button>
          <button class="${danger ? 'danger' : 'primary'}" id="askOk" type="button">${esc(confirm)}</button>
        </div>
      </div>`,
      {
        onDismiss: () => {
          if (!settled) {
            settled = true
            resolve(false)
          }
        }
      }
    )
    document.querySelector('#askCancel').addEventListener('click', () => finish(false))
    document.querySelector('#askOk').addEventListener('click', () => finish(true))
  })
}

void boot()
