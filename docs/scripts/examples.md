# 示例脚本

下面的例子可以直接复制到编辑器里跑。应用里还内置了三个完整脚本，
在「自定义脚本」页选中后能看到全部源码，点「以此为模板新建」就能改。

## 统计每个用户的作品数

最短的一个能跑的脚本，只读不写：

```js
exports.meta = {
  name: '用户作品数统计',
  description: '按作品数量从多到少列出所有用户'
}

exports.run = async (api) => {
  const rows = api.db.query(`
    SELECT u.nickname, COUNT(p.id) AS cnt
    FROM users u
    LEFT JOIN posts p ON p.user_id = u.id
    GROUP BY u.id
    ORDER BY cnt DESC
  `)

  rows.forEach((row) => api.log(`${row.nickname}: ${row.cnt}`))

  return { users: rows.length }
}
```

## 检查失效作品记录

对照数据库和本地文件夹，找出记录还在、文件夹已经没了的作品。
**只报告不删除**——确认结果无误后再按需要改成清理。

这是内置脚本「检查失效作品记录」，核心是 `api.fs.join` + `api.fs.exists`：

```js
exports.meta = {
  name: '检查失效作品记录',
  description: '扫描数据库中本地文件夹已不存在的作品，只报告不删除'
}

exports.run = async (api) => {
  const posts = api.db.query(
    'SELECT id, aweme_id, sec_uid, nickname, folder_name FROM posts ORDER BY id'
  )

  api.log(`共 ${posts.length} 条作品记录，开始比对本地文件夹…`)

  const missing = posts.filter((post) => {
    if (!post.folder_name) return true
    return !api.fs.exists(api.fs.join(api.fs.downloadRoot, post.sec_uid, post.folder_name))
  })

  if (missing.length === 0) {
    api.log('所有作品记录都能对应到本地文件夹，没有发现问题。')
    return { checked: posts.length, missing: 0 }
  }

  api.log(`发现 ${missing.length} 条失效记录：`)
  missing.slice(0, 50).forEach((post) => {
    api.log(`  #${post.id} [${post.nickname ?? '未知作者'}] ${post.folder_name ?? '(无文件夹)'}`)
  })

  return { checked: posts.length, missing: missing.length, ids: missing.map((p) => p.id) }
}
```

要真的清理，把最后改成 `missing.forEach((post) => api.db.posts.delete(post.id))`。
注意 `posts.delete` 只删数据库记录，本地残留文件要另外用 `api.fs.remove` 处理。

## 依次同步全部用户并限流

长任务的标准写法：串行遍历、随机间隔、单个失败不中断、中断能穿透 `try/catch`。
这是内置脚本「依次同步全部用户并限流」的骨架：

```js
const DELAY_MIN_MS = 30 * 1000
const DELAY_MAX_MS = 60 * 1000
const MAX_DOWNLOAD_COUNT = 10

exports.meta = {
  name: '依次同步全部用户并限流',
  description: '按顺序同步每个用户，成功后设置下载上限，用户之间随机延迟避免风控'
}

exports.run = async (api) => {
  const users = api.db.users.list()
  const failed = []

  for (const [index, user] of users.entries()) {
    // 点「停止」后不再开始下一个用户
    api.throwIfCancelled()

    const position = `[${index + 1}/${users.length}]`
    try {
      await api.actions.syncUser(user.id)
      api.db.users.updateSettings(user.id, { max_download_count: MAX_DOWNLOAD_COUNT })
      api.log(`${position} ✔ ${user.nickname} 同步完成`)
    } catch (error) {
      // 停止不算同步失败：抛出去终止整个脚本，不记进失败列表
      if (api.cancelled) throw error
      failed.push({ nickname: user.nickname, error: error.message })
      api.log(`${position} ✖ ${user.nickname} 同步失败：${error.message}`)
    }

    // 最后一个用户之后无需再等
    if (index < users.length - 1) {
      await api.sleep(DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1)))
    }
  }

  return { total: users.length, failed: failed.length, failedUsers: failed }
}
```

## 同步收藏夹作品并下载

把当前登录账号收藏夹里的作品全部添加进来并触发下载。
用到 `api.douyin` 的全部四个方法，是内置脚本「同步收藏夹作品并下载」的精简版：

```js
exports.meta = {
  name: '同步收藏夹作品并下载',
  description: '读取当前登录账号的收藏夹，把里面的作品逐个添加进来并触发下载'
}

exports.run = async (api) => {
  const me = await api.douyin.me()
  if (!me.loggedIn) {
    throw new Error('当前 cookie 未登录，请先在设置里重新登录抖音')
  }
  api.log(`当前登录账号：抖音号 ${me.uniqueId || '未知'}`)

  if (api.db.settings.get('download_post_on_add_user') === 'false') {
    api.log('⚠ 设置里「添加用户时下载作品」是关闭的，本次只会入库、不会下载。')
  }

  // 同一个作品可能同时躺在多个收藏夹里，按 aweme_id 去重
  const seen = new Map()

  for (const collect of await api.douyin.collects()) {
    api.throwIfCancelled()
    const items = await api.douyin.collectsVideos(collect.id)
    items.forEach((item) => {
      if (!seen.has(item.awemeId)) seen.set(item.awemeId, { ...item, from: collect.name })
    })
    api.log(`  收藏夹「${collect.name}」：${items.length} 个作品`)
  }

  // 库里已经有的跳过
  const queue = [...seen.values()].filter((item) => !api.db.posts.getByAwemeId(item.awemeId))
  api.log(`去重并排除已有后，共 ${queue.length} 个作品待添加。`)

  let added = 0
  for (const [index, item] of queue.entries()) {
    api.throwIfCancelled()
    try {
      await api.actions.addVideo(item.awemeId)
      added++
      api.log(`[${index + 1}/${queue.length}] ✔ ${item.nickname} — ${item.desc.slice(0, 30)}`)
    } catch (error) {
      if (api.cancelled) throw error
      api.log(`[${index + 1}/${queue.length}] ✖ ${item.awemeId}：${error.message}`)
    }

    if (index < queue.length - 1) await api.sleep(3000 + Math.floor(Math.random() * 3000))
  }

  api.log('下载在后台进行，脚本结束不代表已经下完，进度看「下载」页。')
  return { account: me.uniqueId, total: queue.length, added }
}
```

内置的完整版还支持只处理指定收藏夹、是否带上未归类的「收藏」、
数量上限等参数，选中它点「以此为模板新建」即可拿到。

## 补齐漏下的作品

对比抖音线上的作品列表和本地数据库，把缺的补下来。
用到 `api.douyin.userVideos`（只查不入库）+ `api.db.posts.getByAwemeId`（判重）+
`api.actions.addVideo`（补下载）：

```js
/** 每个作者只检查最近多少条，0 = 全部（大号会很慢） */
const CHECK_RECENT = 30

exports.meta = {
  name: '补齐漏下的作品',
  description: '对比线上作品列表与本地记录，补下缺失的作品'
}

exports.run = async (api) => {
  const users = api.db.users.list()
  let filled = 0

  for (const user of users) {
    api.throwIfCancelled()

    const online = await api.douyin.userVideos(user.sec_uid, CHECK_RECENT)
    const missing = online.filter((item) => !api.db.posts.getByAwemeId(item.awemeId))

    if (missing.length === 0) {
      api.log(`${user.nickname}：线上 ${online.length} 条，无缺失`)
      continue
    }

    api.log(`${user.nickname}：线上 ${online.length} 条，缺 ${missing.length} 条，开始补`)
    for (const item of missing) {
      api.throwIfCancelled()
      try {
        await api.actions.addVideo(item.awemeId)
        filled++
      } catch (error) {
        if (api.cancelled) throw error
        api.log(`  ✖ ${item.awemeId}：${error.message}`)
      }
      await api.sleep(3000 + Math.floor(Math.random() * 3000))
    }
  }

  api.log(`补齐结束，共触发 ${filled} 个作品的下载。`)
  return { users: users.length, filled }
}
```

## 查作品信息不入库

只想看一眼某个作品的数据，不想把作者添加进来：

```js
const AWEME_IDS = ['7123456789', '7987654321']

exports.meta = { name: '查作品信息' }

exports.run = async (api) => {
  const rows = []
  for (const id of AWEME_IDS) {
    api.throwIfCancelled()
    const info = await api.douyin.video(id)
    api.log(
      `${info.author.nickname} · ${info.desc.slice(0, 30)} · ` +
        `赞 ${info.stats.digg} 藏 ${info.stats.collect} · ` +
        new Date(info.createTime * 1000).toLocaleDateString()
    )
    rows.push({ awemeId: info.awemeId, digg: info.stats.digg })
    await api.sleep(2000)
  }
  return { checked: rows.length, rows }
}
```

## 用 Python 处理下载好的视频

`api.shell` 的典型用法：把本地视频交给 Python 脚本处理，结果回写数据库。
需要先在 **设置 → 系统 → 允许脚本执行本地命令** 开启。

```js
/** 你自己的 Python 脚本，放在脚本目录下即可用相对路径 */
const PY_SCRIPT = 'analyze.py'

exports.meta = {
  name: 'Python 批量处理视频',
  description: '把每个已下载视频交给本地 Python 脚本处理'
}

exports.run = async (api) => {
  if (!api.shell.allowed) {
    api.log('本脚本需要「允许脚本执行本地命令」，请到设置 → 系统里开启后重试。')
    return { skipped: true }
  }

  const posts = api.db.query(
    'SELECT id, aweme_id, sec_uid, folder_name FROM posts WHERE folder_name IS NOT NULL LIMIT 20'
  )

  let done = 0
  const failed = []

  for (const post of posts) {
    api.throwIfCancelled()

    const dir = api.fs.join(api.fs.downloadRoot, post.sec_uid, post.folder_name)
    if (!api.fs.exists(dir)) continue

    // -u 关掉 Python 的输出缓冲，log:true 才能实时看到进度
    const res = await api.shell.run('python3', ['-u', PY_SCRIPT, dir], {
      log: true,
      timeout: 10 * 60 * 1000
    })

    if (res.ok) {
      done++
      // Python 那边 print 一行 JSON，这里接住写回标签
      try {
        const out = JSON.parse(res.stdout.trim().split('\n').pop())
        if (out.tags?.length) api.db.tags.addToPosts([post.id], out.tags)
      } catch {
        api.log(`  #${post.id} 输出不是 JSON，跳过写回`)
      }
    } else {
      failed.push({ id: post.id, code: res.code, error: res.stderr.slice(0, 200) })
      api.log(`  #${post.id} 退出码 ${res.code}`)
    }
  }

  api.log(`处理完成：成功 ${done}，失败 ${failed.length}`)
  return { total: posts.length, done, failed }
}
```

对应的 `analyze.py` 放在脚本目录里（点「打开脚本目录」就能进去），
接收视频文件夹路径、往 stdout 打一行 JSON 即可：

```python
import sys, json

folder = sys.argv[1]
# ... 你的处理逻辑 ...
print(json.dumps({"tags": ["已处理"]}))
```

::: tip 拼路径用 run 的数组参数
上面把 `dir` 作为数组的一项传给 `run`，路径里有空格或中文都不会出问题。
换成 `api.shell.exec('python3 ' + PY_SCRIPT + ' ' + dir)` 就会在这类路径上翻车。
:::

## 批量给作品打标签

按文案关键词批量补标签，展示 `api.db.query` 配合 `api.db.tags.addToPosts`：

```js
const KEYWORD = '教程'
const TAGS = ['教程', '待整理']

exports.meta = {
  name: '按关键词批量打标签',
  description: `给文案里含「${KEYWORD}」的作品加上标签`
}

exports.run = async (api) => {
  const rows = api.db.query('SELECT id FROM posts WHERE desc LIKE ?', [`%${KEYWORD}%`])
  if (rows.length === 0) {
    api.log('没有匹配的作品。')
    return { matched: 0 }
  }

  const affected = api.db.tags.addToPosts(
    rows.map((row) => row.id),
    TAGS
  )
  api.log(`匹配 ${rows.length} 个作品，实际写入 ${affected} 个。`)

  return { matched: rows.length, affected }
}
```
