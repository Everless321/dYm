/* eslint-disable @typescript-eslint/explicit-function-return-type */
const view = document.querySelector('#view')
const login = document.querySelector('#login')
const shell = document.querySelector('#shell')
const modal = document.querySelector('#modal')
const toast = document.querySelector('#toast')

const state = {
  nodes: [],
  keys: [],
  node: null,
  posts: null,
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

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
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
    return { name: 'node', id: decodeURIComponent(parts[1]), tab: parts[2] || 'posts' }
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

function formatMs(value) {
  if (!value) return '还没有连上'
  return new Date(value).toLocaleString()
}

function loginText(info) {
  if (!info?.loggedIn) return '未登录抖音'
  if (info.uniqueId) return `抖音号 ${info.uniqueId}`
  return '已登录'
}

function showLogin() {
  shell.hidden = true
  login.hidden = false
  stopLive()
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
  error.hidden = true
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ token: document.querySelector('#tokenInput').value })
    })
    showShell()
    location.hash = '#/'
    await render()
  } catch (err) {
    error.hidden = false
    error.textContent = err.message
  }
})

document.querySelector('#logoutButton').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {})
  showLogin()
})

window.addEventListener('hashchange', () => {
  state.query.page = 1
  void render().catch((error) => showToast(error.message))
})

async function render() {
  const current = route()
  stopLive()
  if (current.name === 'list') {
    await renderList()
    return
  }
  await renderNode(current.id, current.tab)
}

async function renderList() {
  const [nodes, keys] = await Promise.all([api('/api/nodes'), api('/api/keys')])
  state.nodes = nodes.nodes
  state.keys = keys.keys
  const cards = state.nodes
    .map((node) => {
      const counts = node.counts || {}
      return `<a class="node-card" href="#/n/${encodeURIComponent(node.id)}/posts">
        <div class="spread">
          <strong>${esc(node.name)}</strong>
          <span class="pill"><i class="dot ${node.online ? 'on' : ''}"></i>${node.online ? '在线' : '离线'}</span>
        </div>
        <div class="muted">${esc(node.hostname || '未知主机')} · ${esc(node.version || '未知版本')}</div>
        <div>${esc(loginText(node.login))}</div>
        <div class="muted">用户 ${counts.users || 0} · 作品 ${counts.posts || 0} · 最近 ${esc(formatMs(node.lastSeen))}</div>
      </a>`
    })
    .join('')
  const keyRows = state.keys
    .map(
      (key) => `<tr>
        <td>${esc(key.name)}</td>
        <td><code>${esc(key.prefix)}…</code></td>
        <td>${key.online ? '在线' : '离线'}</td>
        <td><button class="danger" type="button" data-revoke="${esc(key.id)}">吊销</button></td>
      </tr>`
    )
    .join('')
  view.innerHTML = `<div class="stack">
    <div class="spread">
      <div>
        <h2>客户端</h2>
        <p class="muted">点进一台之后再管理。各台的作品不会混在一起。</p>
      </div>
    </div>
    <div class="grid">${cards || '<div class="panel">还没有客户端。先在下面签发一把密钥，填进 dYm。</div>'}</div>
    <section class="panel">
      <h2>节点密钥</h2>
      <p class="muted">一把密钥对应一台电脑。密钥只在签发时完整显示一次。</p>
      <form id="keyForm" class="row">
        <input id="keyName" placeholder="例如：客厅电脑" />
        <button class="primary" type="submit">签发密钥</button>
      </form>
      <div class="table-wrap"><table>
        <thead><tr><th>名称</th><th>前缀</th><th>状态</th><th></th></tr></thead>
        <tbody>${keyRows || '<tr><td colspan="4">还没有密钥</td></tr>'}</tbody>
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
  const name = document.querySelector('#keyName').value
  try {
    const issued = await api('/api/keys', { method: 'POST', body: JSON.stringify({ name }) })
    openModal(`<h2>密钥已签发</h2>
      <p class="muted">请立刻复制到对应电脑的 dYm 设置里。关闭后不能再查看完整密钥。</p>
      <div class="key-box" id="fullKey"></div>
      <div class="row"><button class="primary" id="copyKey" type="button">复制</button><button class="ghost" id="closeModal" type="button">关闭</button></div>`)
    document.querySelector('#fullKey').textContent = issued.key
    document.querySelector('#copyKey').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(issued.key)
        showToast('已复制')
      } catch {
        showToast('请手动选中密钥复制')
      }
    })
    document.querySelector('#closeModal').addEventListener('click', closeModal)
    await renderList()
  } catch (error) {
    showToast(error.message)
  }
}

async function onRevoke(id) {
  if (!confirm('吊销后，使用这把密钥的电脑会断开，确定继续？')) return
  try {
    await api(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' })
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
  let node = state.nodes.find((item) => item.id === id)
  try {
    const data = await api(`/api/nodes/${encodeURIComponent(id)}`)
    node = data.node
  } catch (error) {
    view.innerHTML = `<p class="error">${esc(error.message)}</p>`
    return
  }
  state.node = node
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
  view.innerHTML = `<div class="stack">
    <div>
      <a class="muted" href="#/">返回客户端列表</a>
      <div class="spread">
        <h2>${esc(node.name)}</h2>
        <span class="pill"><i class="dot ${node.online ? 'on' : ''}"></i>${node.online ? '在线' : '离线'}</span>
      </div>
      <p class="muted">${esc(node.hostname || '')} · ${esc(node.version || '')} · ${esc(loginText(node.login))}</p>
      <p class="muted">抖音登录需要在这台电脑的 dYm 窗口里完成，管理端这里只显示状态。</p>
    </div>
    <div class="tabs">${tabs}</div>
    <div id="pane"></div>
  </div>`
  const pane = document.querySelector('#pane')
  if (!node.online) {
    const counts = node.counts || {}
    pane.innerHTML = `<div class="panel">这台客户端离线，暂时不能浏览或操作。上次上报：用户 ${counts.users || 0}，作品 ${counts.posts || 0}。</div>`
    return
  }
  try {
    if (tab === 'users') await renderUsers(pane, node)
    else if (tab === 'tasks') await renderTasks(pane, node)
    else await renderPosts(pane, node)
  } catch (error) {
    pane.innerHTML = `<p class="error">${esc(error.message)}</p>`
  }
  listen(node.id, tab)
}

function listen(nodeId, tab) {
  stopLive()
  events = new EventSource(`/api/nodes/${encodeURIComponent(nodeId)}/events`)
  events.addEventListener('sync', (event) => {
    const data = JSON.parse(event.data)
    state.live.sync[data.userId] = data
    if (tab === 'users' && document.activeElement?.closest('form, input, select') == null) {
      const cell = document.querySelector(`[data-sync="${data.userId}"]`)
      if (cell) cell.textContent = data.message || data.status || ''
    }
  })
  events.addEventListener('download', (event) => {
    const data = JSON.parse(event.data)
    state.live.download[data.taskId] = data
    const cell = document.querySelector(`[data-task="${data.taskId}"]`)
    if (cell) cell.textContent = data.message || data.status || ''
  })
  events.addEventListener('snapshot', () => {
    const badge = document.querySelector('.pill')
    if (badge) badge.innerHTML = '<i class="dot on"></i>在线'
  })
  pollTimer = window.setInterval(async () => {
    const data = await api(`/api/nodes/${encodeURIComponent(nodeId)}`).catch(() => null)
    if (!data) return
    state.node = data.node
  }, 8000)
}

function stopLive() {
  events?.close()
  events = null
  clearInterval(pollTimer)
}

async function renderPosts(pane, node, refocus = false) {
  const gen = ++postsGen
  if (!state.tagsLoaded) {
    const tags = await rpc(node.id, 'tags.list').catch(() => ({ tags: [] }))
    if (gen !== postsGen) return
    state.tags = tags.tags || []
    state.tagsLoaded = true
  }
  const query = state.query
  const result = await rpc(node.id, 'posts.list', query)
  if (gen !== postsGen) return
  state.posts = result
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
      return `<button class="post" type="button" data-post="${index}">
        ${cover ? `<img alt="" data-src="${esc(cover)}" />` : '<div class="cover-fallback"></div>'}
        <div><strong>${esc(post.author?.nickname || '')}</strong><span>${esc(post.desc || post.caption || post.awemeId)}</span></div>
      </button>`
    })
    .join('')
  const pages = Math.max(1, Math.ceil((result.total || 0) / result.pageSize))
  pane.innerHTML = `<div class="filters">
      <input id="keyword" placeholder="搜索描述、作者、标签" value="${esc(query.keyword)}" />
      <select id="author"><option value="">全部作者</option>${authors}</select>
      <select id="tag"><option value="">全部标签</option>${tags}</select>
      <label class="row"><input id="analyzed" type="checkbox" ${query.analyzedOnly ? 'checked' : ''} />只看已分析</label>
    </div>
    <div class="posts">${cards || '<div class="panel">没有作品</div>'}</div>
    <div class="row" style="margin-top:12px">
      <button class="ghost" id="prev" type="button" ${query.page <= 1 ? 'disabled' : ''}>上一页</button>
      <span class="muted">${result.page} / ${pages} · 共 ${result.total} 个</span>
      <button class="ghost" id="next" type="button" ${result.hasMore ? '' : 'disabled'}>下一页</button>
    </div>`
  pane.querySelectorAll('img[data-src]').forEach((img) => {
    img.src = img.dataset.src
  })
  pane.querySelector('#keyword').addEventListener('input', (event) => {
    state.query.keyword = event.target.value
    state.query.page = 1
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      void renderPosts(pane, node, true)
    }, 300)
  })
  if (refocus) {
    const input = pane.querySelector('#keyword')
    input.focus()
    const end = input.value.length
    input.setSelectionRange(end, end)
  }
  pane.querySelector('#author').addEventListener('change', (event) => {
    state.query.secUid = event.target.value
    state.query.page = 1
    void renderPosts(pane, node)
  })
  pane.querySelector('#tag').addEventListener('change', (event) => {
    state.query.tag = event.target.value
    state.query.page = 1
    void renderPosts(pane, node)
  })
  pane.querySelector('#analyzed').addEventListener('change', (event) => {
    state.query.analyzedOnly = event.target.checked
    state.query.page = 1
    void renderPosts(pane, node)
  })
  pane.querySelector('#prev').addEventListener('click', () => {
    state.query.page = Math.max(1, state.query.page - 1)
    void renderPosts(pane, node)
  })
  pane.querySelector('#next').addEventListener('click', () => {
    state.query.page += 1
    void renderPosts(pane, node)
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
  const images = (post.images || []).map((image) => mediaUrl(nodeId, image)).filter(Boolean)
  const body = post.isImagePost
    ? images.map((src) => `<img class="full" alt="" data-src="${esc(src)}" />`).join('')
    : video
      ? `<video controls autoplay data-src="${esc(video)}"></video>`
      : '<p class="muted">没有可播放的文件</p>'
  const tags = (post.analysis?.tags || []).join('、')
  openModal(`<div class="spread"><h2>${esc(post.author?.nickname || '')}</h2><button class="ghost" id="closeModal" type="button">关闭</button></div>
    <p>${esc(post.desc || post.caption || '')}</p>
    <p class="muted">${esc(post.analysis?.summary || '')} ${esc(tags)}</p>
    ${body}`)
  modal.querySelectorAll('[data-src]').forEach((el) => {
    el.src = el.dataset.src
  })
  document.querySelector('#closeModal').addEventListener('click', closeModal)
}

async function renderUsers(pane, node) {
  if (!node.online) return
  const result = await rpc(node.id, 'users.list')
  state.users = result.users || []
  const rows = state.users
    .map((user) => {
      const live = state.live.sync[user.id]
      const avatar = mediaUrl(node.id, user.avatar)
      return `<tr>
        <td>${avatar ? `<img class="avatar" alt="" data-src="${esc(avatar)}" />` : ''}</td>
        <td><strong>${esc(user.nickname)}</strong><div class="muted">${esc(user.uniqueId || user.remark || '')}</div></td>
        <td>${user.downloadedCount}/${user.awemeCount}</td>
        <td data-sync="${user.id}">${esc(live?.message || (user.syncing ? '同步中' : user.syncStatus))}</td>
        <td class="row">
          <button class="ghost" type="button" data-sync-start="${user.id}">同步</button>
          <button class="ghost" type="button" data-refresh="${user.id}">刷新</button>
          <button class="ghost" type="button" data-edit="${user.id}">设置</button>
          <button class="danger" type="button" data-delete="${user.id}">删除</button>
        </td>
      </tr>`
    })
    .join('')
  pane.innerHTML = `<form id="addUser" class="row">
      <input id="userUrl" placeholder="用户主页或作品链接" style="flex:1" />
      <button class="primary" type="submit">添加用户</button>
    </form>
    <div class="table-wrap"><table>
      <thead><tr><th></th><th>用户</th><th>已下载</th><th>同步</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">还没有用户</td></tr>'}</tbody>
    </table></div>`
  pane.querySelectorAll('img[data-src]').forEach((img) => {
    img.src = img.dataset.src
  })
  pane.querySelector('#addUser').addEventListener('submit', async (event) => {
    event.preventDefault()
    try {
      await rpc(node.id, 'users.add', { url: document.querySelector('#userUrl').value })
      showToast('已添加')
      await renderUsers(pane, node)
    } catch (error) {
      showToast(error.message)
    }
  })
  bindUserActions(pane, node)
}

function bindUserActions(pane, node) {
  pane.querySelectorAll('[data-sync-start]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await rpc(node.id, 'users.sync', { id: Number(button.dataset.syncStart) })
        showToast('已开始同步')
      } catch (error) {
        showToast(error.message)
      }
    })
  })
  pane.querySelectorAll('[data-refresh]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await rpc(node.id, 'users.refresh', { id: Number(button.dataset.refresh) })
        showToast('资料已刷新')
        await renderUsers(pane, node)
      } catch (error) {
        showToast(error.message)
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
      if (!confirm('从列表删除这个用户？')) return
      const deleteFiles = confirm('同时删除已下载的文件？取消则只从列表移除。')
      try {
        await rpc(node.id, 'users.delete', { id: Number(button.dataset.delete), deleteFiles })
        await renderUsers(pane, node)
      } catch (error) {
        showToast(error.message)
      }
    })
  })
}

function openUserSettings(node, user, pane) {
  openModal(`<h2>${esc(user.nickname)}</h2>
    <form id="userSettings" class="stack">
      <label>备注<input name="remark" value="${esc(user.remark)}" /></label>
      <label>单用户下载上限（0 表示用全局设置）<input name="maxDownloadCount" type="number" min="0" value="${user.maxDownloadCount}" /></label>
      <label>自动同步 Cron<input name="syncCron" value="${esc(user.syncCron)}" placeholder="留空表示不定时" /></label>
      <label class="row"><input name="showInHome" type="checkbox" ${user.showInHome ? 'checked' : ''} />在桌面端首页显示</label>
      <label class="row"><input name="autoSync" type="checkbox" ${user.autoSync ? 'checked' : ''} />启用自动同步</label>
      <div class="row"><button class="primary" type="submit">保存</button><button class="ghost" id="closeModal" type="button">关闭</button></div>
    </form>`)
  document.querySelector('#closeModal').addEventListener('click', closeModal)
  document.querySelector('#userSettings').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
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
    }
  })
}

async function renderTasks(pane, node) {
  if (!node.online) return
  const [tasks, users] = await Promise.all([
    rpc(node.id, 'tasks.list'),
    state.users.length ? { users: state.users } : rpc(node.id, 'users.list')
  ])
  state.tasks = tasks.tasks || []
  state.users = users.users || state.users
  const options = state.users
    .map(
      (user) =>
        `<label class="row"><input type="checkbox" value="${user.id}" />${esc(user.nickname)}</label>`
    )
    .join('')
  const rows = state.tasks
    .map((task) => {
      const live = state.live.download[task.id] || task.progress
      const names = (task.users || []).map((user) => user.nickname).join('、')
      return `<tr>
        <td><strong>${esc(task.name)}</strong><div class="muted">${esc(names)}</div></td>
        <td>${esc(task.running ? '进行中' : task.status)}</td>
        <td data-task="${task.id}">${esc(live?.message || `${task.downloadedVideos || 0} 个`)}</td>
        <td class="row">
          <button class="ghost" type="button" data-start="${task.id}">开始</button>
          <button class="ghost" type="button" data-stop="${task.id}">停止</button>
          <button class="danger" type="button" data-remove="${task.id}">删除</button>
        </td>
      </tr>`
    })
    .join('')
  pane.innerHTML = `<form id="createTask" class="panel stack">
      <strong>新建下载任务</strong>
      <input name="name" placeholder="任务名称" required />
      <div class="grid">${options || '<span class="muted">先添加用户</span>'}</div>
      <button class="primary" type="submit">创建</button>
    </form>
    <div class="table-wrap"><table>
      <thead><tr><th>任务</th><th>状态</th><th>进度</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">还没有下载任务</td></tr>'}</tbody>
    </table></div>`
  pane.querySelector('#createTask').addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const userIds = [...form.querySelectorAll('input[type="checkbox"]:checked')].map((input) =>
      Number(input.value)
    )
    try {
      await rpc(node.id, 'tasks.create', { name: form.name.value, userIds })
      showToast('已创建')
      await renderTasks(pane, node)
    } catch (error) {
      showToast(error.message)
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
      if (!confirm('删除这个下载任务？')) return
      try {
        await rpc(node.id, 'tasks.delete', { id: Number(button.dataset.remove) })
        await renderTasks(pane, node)
      } catch (error) {
        showToast(error.message)
      }
    })
  })
}

function openModal(html) {
  modal.hidden = false
  modal.innerHTML = `<div class="card">${html}</div>`
  modal.addEventListener('click', onModalBackdrop)
}

function onModalBackdrop(event) {
  if (event.target === modal) closeModal()
}

function closeModal() {
  modal.hidden = true
  modal.innerHTML = ''
  modal.removeEventListener('click', onModalBackdrop)
}

void boot()
