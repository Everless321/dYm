# API 参考

`run(api, event?)` 的入参 `api` 是脚本的全部能力来源。沙箱里没有 `require`，
所以文件、网络、数据库一律从这里走。第二个参数 `event` 只在[事件钩子](/scripts/hooks)
触发时有值，手动运行或 cron 时为空。

| 命名空间 | 作用 |
| --- | --- |
| [`api.log` / `sleep` / `cancelled`](#运行控制) | 输出日志、等待、响应停止 |
| [`api.db`](#api-db) | 读写本地 SQLite |
| [`api.actions`](#api-actions) | 添加用户、同步、下载、分析 |
| [`api.douyin`](#api-douyin) | 查作品/作者/收藏夹，带 cookie 与签名 |
| [`api.fs`](#api-fs) | 读写下载目录与用户数据目录 |
| [`api.shell`](#api-shell) | 执行本地命令（默认关闭） |
| [`api.net`](#api-net) | 裸 HTTP 请求 |

## 运行控制

### api.log()

```ts
api.log(...args: unknown[]): void
```

输出一行到「输出」标签页。非字符串参数会被格式化展开（对象最多 4 层），
多个参数用空格连接。

```js
api.log('用户', { id: 7, nickname: '张三' })
// 用户 { id: 7, nickname: '张三' }
```

### api.sleep()

```ts
api.sleep(ms: number): Promise<void>
```

暂停指定毫秒数，用于给连续请求之间加间隔。**等待期间响应「停止」**，
点停止会立即中断，不必等满整个间隔。

### api.cancelled

```ts
readonly api.cancelled: boolean
```

是否已被请求停止。纯计算循环靠它主动让出，详见[运行与停止](/scripts/lifecycle)。

### api.throwIfCancelled()

```ts
api.throwIfCancelled(): void
```

已请求停止时抛出中断错误，用于在循环里一行搞定检查。

## api.db

本地 SQLite 的读写入口。底层是 better-sqlite3，**全部是同步调用**，不需要 `await`。

### api.db.query()

```ts
api.db.query<T = Row>(sql: string, params?: unknown[]): T[]
```

只读查询。**仅允许 `SELECT` / `WITH` 开头的语句**，其它语句会被拒：

```
api.db.query 仅允许 SELECT / WITH 查询，写入请用 api.db.exec
```

```js
const rows = api.db.query('SELECT id, nickname FROM users WHERE aweme_count > ?', [100])
```

### api.db.exec()

```ts
api.db.exec(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number }
```

写入语句（`INSERT` / `UPDATE` / `DELETE` 等）。没有任何护栏，
**改错了没法撤销**，动手前先用 `query` 把要改的行捞出来看一眼。

### api.db.users

```ts
api.db.users.list(): Row[]
api.db.users.getById(id: number): Row | undefined
api.db.users.getBySecUid(secUid: string): Row | undefined
api.db.users.updateSettings(id: number, patch: UserSettingsPatch): Row | undefined
api.db.users.delete(id: number): { sec_uid: string } | undefined
```

`updateSettings` 只传需要改的字段，可选字段有：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `show_in_home` | boolean | 是否在首页显示 |
| `max_download_count` | number | 用户级下载上限，0 = 用全局设置 |
| `remark` | string | 备注 |
| `auto_sync` | boolean | 是否自动同步 |
| `sync_cron` | string | 自动同步的 cron 表达式 |
| `live_record` | boolean | 是否自动录制直播 |
| `live_check_cron` | string | 直播检测的 cron 表达式 |

```js
api.db.users.updateSettings(7, { max_download_count: 10, auto_sync: true })
```

::: warning delete 会连带删除
`users.delete` 走的是外键级联，该用户的 `posts`、`live_records`、任务关联都会一起没。
:::

### api.db.posts

```ts
api.db.posts.listByUserId(userId: number): Row[]
api.db.posts.getById(id: number): Row | undefined
api.db.posts.getByAwemeId(awemeId: string): Row | undefined
api.db.posts.setTags(id: number, input: { aiTags?: string[]; manualTags?: string[] }): void
api.db.posts.delete(id: number): Row | undefined
```

`getByAwemeId` 常用来判重——批量添加前先看库里有没有：

```js
if (!api.db.posts.getByAwemeId(awemeId)) {
  await api.actions.addVideo(awemeId)
}
```

`delete` 只删数据库记录，**不会删本地文件**。

### api.db.tags

```ts
api.db.tags.all(): string[]
api.db.tags.rename(oldName: string, newName: string): number
api.db.tags.merge(names: string[], into: string): number
api.db.tags.delete(names: string[]): number
api.db.tags.addToPosts(postIds: number[], tags: string[]): number
```

都返回受影响的作品数。

### api.db.settings

```ts
api.db.settings.get(key: string): string | null
api.db.settings.set(key: string, value: string): void
```

值一律是字符串，布尔类开关存的是 `'true'` / `'false'`：

```js
if (api.db.settings.get('download_post_on_add_user') === 'false') {
  api.log('「添加用户时下载作品」是关的，本次只入库不下载')
}
```

### 数据库表结构

| 表 | 说明 |
| --- | --- |
| `users` | 作者 |
| `posts` | 作品 |
| `download_tasks` | 下载任务 |
| `task_users` | 任务与作者的关联 |
| `live_records` | 直播录制记录 |
| `settings` | 键值设置 |

`posts` 常用字段：

| 字段 | 说明 |
| --- | --- |
| `id` / `aweme_id` | 主键 / 抖音作品 ID |
| `user_id` / `sec_uid` / `nickname` | 作者 |
| `desc` / `caption` | 文案 |
| `aweme_type` | 0 = 视频，其它值为图文 |
| `create_time` | 作品发布时间 |
| `folder_name` | 该作品在下载目录里的文件夹名 |
| `video_path` / `cover_path` / `music_path` | 本地文件路径 |
| `downloaded_at` / `analyzed_at` | Unix 秒 |
| `analysis_tags` / `manual_tags` | JSON 字符串数组 |
| `analysis_category` / `analysis_summary` / `analysis_scene` | AI 分析结果 |
| `analysis_content_level` | AI 判定的内容分级 |

`users` 常用字段：`id`、`sec_uid`、`uid`、`nickname`、`aweme_count`、
`downloaded_count`、`max_download_count`、`auto_sync`、`sync_cron`、
`live_record`、`last_sync_at`、`sync_status`、`homepage_url`。

## api.actions

界面上按钮背后的同一批函数，全部返回 Promise。

### api.actions.addUser()

```ts
api.actions.addUser(url: string): Promise<AddUserResult>
```

接受**主页链接**或**作品链接**。传作品链接时会先解析出作者、把作者入库，
再按设置「添加用户时下载作品」触发该作品的下载。

```js
const result = await api.actions.addUser('https://www.douyin.com/user/MS4wLjABAAAA...')
// result.isNewUser              是否是新增作者
// result.user.nickname          作者昵称
// result.postDownload.status    下载触发结果
```

`postDownload.status` 的取值：

| 值 | 含义 |
| --- | --- |
| `downloading` | 已在后台开始下载 |
| `already-downloaded` | 本地已有该作品 |
| `disabled` | 设置里关掉了「添加用户时下载作品」 |
| `unavailable` | 拿不到作品数据 |
| `not-video-link` | 传的是主页链接，没有作品要下 |

::: warning 下载是后台进行的
返回时下载才刚开始排队，**不代表文件已经下完**。要在文件落地之后接着处理，
新建脚本时把触发时机选成「作品下载完成」，见[事件钩子](/scripts/hooks)。
:::

### api.actions.addVideo()

```ts
api.actions.addVideo(urlOrAwemeId: string): Promise<AddUserResult>
```

添加单个作品，效果等同于给 `addUser` 传作品链接，但**可以直接传裸 `aweme_id`**，
不用自己拼 URL。返回值与 `addUser` 完全相同。批量处理作品列表时用它：

```js
for (const item of await api.douyin.collectsVideos(collectsId)) {
  await api.actions.addVideo(item.awemeId)
  await api.sleep(3000)
}
```

### 其它操作

```ts
api.actions.syncUser(userId: number): Promise<void>        // 同步该用户的作品列表
api.actions.runTask(taskId: number): Promise<void>          // 执行一个下载任务
api.actions.analyze(secUid?: string): Promise<void>         // 分析未分析的作品，不传则全部
api.actions.reanalyzePosts(postIds: number[]): Promise<void> // 重新分析指定作品
```

`syncUser` 走的是该用户当前的下载上限（用户级 >0 时优先，否则用全局设置），
脚本不会临时放开限制。

## api.douyin

只读接口，走应用里配置的 cookie 与 A-Bogus 签名。没配 cookie 会直接报错：

```
未配置抖音 Cookie，请先在「设置 - 账号」里登录后再运行
```

::: tip 拿到的一定是「我」的数据
收藏相关接口没有用户参数——抖音是按 cookie 判断「我」是谁的，
所以拿到的必然是当前登录账号自己的收藏。
:::

分页在内部完成，翻页之间固定间隔 **1.5 秒**，且响应「停止」。

### api.douyin.me()

```ts
api.douyin.me(): Promise<{ uid: string | null; uniqueId: string | null; loggedIn: boolean }>
```

当前 cookie 对应的登录账号。`uniqueId` 是抖音号。批量任务开头用它做守卫：

```js
const me = await api.douyin.me()
if (!me.loggedIn) throw new Error('当前 cookie 未登录，请先在设置里重新登录抖音')
api.log(`当前登录账号：抖音号 ${me.uniqueId}`)
```

### api.douyin.video()

```ts
api.douyin.video(urlOrAwemeId: string): Promise<DouyinVideoInfo>
```

查单个作品的信息，**只查不添加**。入参可以是作品链接（含短链）或裸 `aweme_id`。

```js
const info = await api.douyin.video('7123456789')
api.log(`${info.author.nickname} · ${info.desc}`)
api.log(`点赞 ${info.stats.digg} 收藏 ${info.stats.collect}`)
api.log(`发布于 ${new Date(info.createTime * 1000).toLocaleString()}`)
```

返回的 `DouyinVideoInfo`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `awemeId` | string | 作品 ID |
| `desc` | string | 文案 |
| `createTime` | number | 发布时间，**Unix 秒** |
| `duration` | number \| null | 时长（毫秒），图文为 null |
| `awemeType` | number \| null | 0 = 视频，其它值为图文 |
| `cover` | string \| null | 封面图地址 |
| `videoUrl` | string \| null | 无水印播放地址，图文为 null |
| `images` | string[] \| null | 图文的图片地址，视频为 null |
| `author` | object | `{ secUid, nickname, uid, uniqueId }` |
| `stats` | object | `{ digg, comment, collect, share }` |
| `hashtags` | string[] | 话题标签名 |

::: warning 没有 cookie 时字段会变少
没配 cookie 时会回落到移动端分享页，那条路拿不到 `hashtags`、`uniqueId`、`awemeType`，
对应字段会是空数组或 null。
:::

### api.douyin.user()

```ts
api.douyin.user(urlOrSecUid: string): Promise<DouyinUserInfo>
```

查作者资料，**只查不添加**。入参可以是主页链接（含短链）或 `sec_uid`。

```js
const user = await api.douyin.user('MS4wLjABAAAA...')
api.log(`${user.nickname}（${user.uniqueId}）粉丝 ${user.followerCount}`)
```

返回字段：`secUid`、`uid`、`nickname`、`signature`、`avatar`、`uniqueId`、
`shortId`、`followerCount`、`followingCount`、`awemeCount`、`totalFavorited`。

广告号或已注销账号会抛错。

### api.douyin.userVideos()

```ts
api.douyin.userVideos(secUid: string, limit?: number): Promise<CollectedAweme[]>
```

从抖音拉作者的作品列表，**不入库**。`limit` 是条数上限，不传或传 0 会一直翻到最后一页——
大号作品上千条时记得设个上限。

```js
// 只看最近 20 条
const recent = await api.douyin.userVideos(secUid, 20)

// 找出线上有、但本地还没下的
const missing = recent.filter((item) => !api.db.posts.getByAwemeId(item.awemeId))
api.log(`有 ${missing.length} 条还没下载`)
```

### api.douyin.parseUrl()

```ts
api.douyin.parseUrl(url: string): Promise<{ type: 'user' | 'video' | 'unknown'; id: string }>
```

识别一条抖音链接是主页还是作品，**支持 `v.douyin.com` 短链**（会发请求解析）。
`id` 对应主页的 `sec_uid` 或作品的 `aweme_id`，识别失败时 `type` 为 `unknown`、`id` 为空串。

```js
const link = await api.douyin.parseUrl(text)
if (link.type === 'video') await api.actions.addVideo(link.id)
else if (link.type === 'user') await api.actions.addUser(`https://www.douyin.com/user/${link.id}`)
else api.log('识别不了这条链接：' + text)
```

### api.douyin.collects()

```ts
api.douyin.collects(): Promise<{ id: string; name: string; total: number }[]>
```

收藏夹列表。`total` 是该收藏夹里的作品数。

### api.douyin.collectsVideos()

```ts
api.douyin.collectsVideos(collectsId: string): Promise<CollectedAweme[]>
```

指定收藏夹里的全部作品，会一直翻到最后一页。

### api.douyin.collectionVideos()

```ts
api.douyin.collectionVideos(): Promise<CollectedAweme[]>
```

「收藏」里的全部作品，包含没有归入任何收藏夹的。

`CollectedAweme` 是作品列表类接口（`userVideos` / `collectsVideos` / `collectionVideos`）
共用的摘要形状：

```ts
{
  awemeId: string // 作品 ID
  desc: string // 文案
  nickname: string // 作者昵称
  secUid: string // 作者 sec_uid
  createTime: number // 发布时间，Unix 秒；拿不到时为 0
}
```

只有这五个字段，要更多信息用 [`api.douyin.video()`](#api-douyin-video) 单独查。
拿到 `awemeId` 后 `api.actions.addVideo(awemeId)` 就能入库并下载，
完整例子见[示例脚本](/scripts/examples#同步收藏夹作品并下载)。

## api.fs

下载目录与用户数据目录里的文件读写。

::: danger 路径限制
只能操作**下载目录**和**用户数据目录**里的路径，越界会抛错：

```
路径超出允许范围：/Users/xxx/Desktop
允许的根目录：…
```

这是为了防止脚本手滑动到家目录。`remove` 是递归删除且不进回收站，**删了就没了**。
:::

```ts
api.fs.downloadRoot: string   // 下载根目录绝对路径
api.fs.userDataRoot: string   // 用户数据目录绝对路径（数据库、脚本目录所在处）

api.fs.join(...segments: string[]): string
api.fs.exists(path: string): boolean
api.fs.list(dir: string): { name: string; path: string; isDirectory: boolean; size: number }[]
api.fs.read(path: string): string
api.fs.write(path: string, content: string): void
api.fs.remove(path: string): void   // 文件或整个目录，递归
api.fs.move(from: string, to: string): void
api.fs.mkdir(path: string): void    // 递归创建
```

沙箱里没有 `path` 模块，拼路径一律用 `api.fs.join`——它按当前系统的分隔符拼接，
在 Windows 上也是对的：

```js
const dir = api.fs.join(api.fs.downloadRoot, post.sec_uid, post.folder_name)
if (!api.fs.exists(dir)) api.log('文件夹不见了：' + dir)
```

`read` / `write` 只处理 UTF-8 文本，不支持二进制。

## api.shell

调用本地程序——python、ffmpeg、自己写的 CLI 都行。

::: danger 默认关闭，开启前想清楚
这是整套 API 里唯一能跳出应用边界的接口。其它接口的限制（沙箱没有 `require`、
`api.fs` 只能碰两个目录）挡的是手滑，不是恶意；**能执行任意命令之后，脚本能做的事
和你本人在终端里一样多**。

要用先到 **设置 → 系统 → 允许脚本执行本地命令** 打开（该开关只在开发者模式下显示）。
关着时调用会直接抛错：

```
脚本执行本地命令未开启。请到「设置 - 系统 - 允许脚本执行本地命令」打开后重试。
```

跑别人写的脚本时建议保持关闭。
:::

### api.shell.run()

```ts
api.shell.run(file: string, args?: string[], options?: ShellOptions): Promise<ShellResult>
```

直接执行程序，**不经过 shell**。参数以数组传入，由系统负责转义——
路径里有空格、引号、中文都不用自己处理，也不存在命令注入。**优先用这个。**

```js
const res = await api.shell.run('python3', ['analyze.py', '--input', post.video_path])
if (res.ok) api.log(res.stdout)
else api.log('失败：' + res.stderr)
```

### api.shell.exec()

```ts
api.shell.exec(command: string, options?: ShellOptions): Promise<ShellResult>
```

整条命令交给系统 shell，**可以用管道、重定向、通配符**。代价是参数要自己转义：

```js
const res = await api.shell.exec('ls -1 *.mp4 | wc -l', { cwd: api.fs.downloadRoot })
api.log(`共 ${res.stdout.trim()} 个 mp4`)
```

::: warning 别把变量直接拼进 exec
文件名里的空格或引号会让命令跑偏。拼变量的场景一律用 `run`。
:::

### api.shell.allowed

```ts
readonly api.shell.allowed: boolean
```

当前是否已开启。脚本开头可以先探测，给出比抛异常更友好的提示：

```js
if (!api.shell.allowed) {
  api.log('本脚本需要「允许脚本执行本地命令」，请到设置里开启后重试。')
  return { skipped: true }
}
```

### 返回值与可选项

`ShellResult`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ok` | boolean | 退出码是否为 0 |
| `code` | number \| null | 退出码；被信号杀掉时为 null |
| `stdout` / `stderr` | string | 完整输出，各自上限 5 MB，超出会截断并在面板提示 |
| `signal` | string \| null | 被信号终止时的信号名 |

`ShellOptions`：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `cwd` | 脚本目录 | 工作目录 |
| `env` | — | 追加的环境变量，与应用环境合并 |
| `input` | — | 写入 stdin 的内容 |
| `timeout` | 0（不限） | 超时毫秒数，到点杀进程并抛错 |
| `log` | false | 把 stdout / stderr 按行实时推到运行面板 |

长任务建议开 `log: true`，否则输出要等命令结束才能看到：

```js
await api.shell.run('python3', ['-u', 'long_job.py'], { log: true })
```

::: tip python 记得加 -u
Python 默认对管道做块缓冲，不加 `-u` 的话 `log: true` 也要等进程结束才出东西。
:::

### 停止与 PATH

点「停止」会给子进程发 `SIGTERM`，命令和脚本一起结束——不会出现脚本停了
python 还在后台跑的情况。

应用从 Finder / 开始菜单启动时拿到的 `PATH` 很短，homebrew、pyenv 装的东西通常不在里面。
已经自动补上了 `/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`、`/bin`。
仍然找不到时会报：

```
找不到可执行文件：xxx。应用从图形界面启动时 PATH 很短，请改用绝对路径…
```

这时在终端里 `which python3` 拿到绝对路径写进脚本即可。

## api.net

```ts
api.net.fetch(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<{ status: number; ok: boolean; headers: Record<string, string>; body: string }>
```

裸 HTTP 请求，**不带任何 cookie 和签名**——要打抖音接口请用 [`api.douyin`](#api-douyin)。
响应体一次性读成字符串返回，不支持流式。

```js
const res = await api.net.fetch('https://example.com/api', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ hello: 'world' })
})
if (res.ok) api.log(JSON.parse(res.body))
```
