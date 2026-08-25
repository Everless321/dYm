/**
 * 写入脚本目录的 API 参考。与 types.ts 的 ScriptApi 保持同步。
 */
export const SCRIPTS_README = `# 自定义脚本

脚本可以直接在应用「自定义脚本」页里写：点「新建脚本」建一个，在「代码」标签页编辑，
⌘/Ctrl+S 保存，点「运行」会先保存再执行。内置脚本只读，可以「以此为模板新建」复制一份来改。

也可以把 \`.js\` 文件放进本目录，回到应用点「重新扫描」即可看到。两种方式改的是同一批文件。

## 脚本结构

CommonJS 风格，必须导出 \`meta\` 和 \`run\`。
新建时选「什么时候运行」：仅手动/定时，或挂到一个应用事件。
钩子位置写入 \`meta.hook\`，对应入参会出现在模板注释里，不用自己注册函数。

\`\`\`js
exports.meta = {
  name: '脚本名称',          // 必填
  description: '一句话说明', // 可选
  timeout: 0,                // 可选，执行超时（毫秒）。不填或 0 = 不限时长
  hook: 'post.downloaded'    // 可选。创建时选「作品下载完成」会自动写上
}

exports.run = async (api, event) => {
  api.log('开始')
  // 钩子触发时 event 带这次的数据；手动点运行时 event 为空
  return { done: true }
}
\`\`\`

脚本在 vm 沙箱里求值，**没有 \`require\`**，所有能力都通过 \`run(api)\` 的入参获得。
顶层代码在扫描列表时就会执行，所以顶层只做声明，实际逻辑写在 \`run\` 里。

## 事件钩子

\`meta.hook\` 可选值：

- \`post.downloaded\` 作品下载完成（任务 / 同步 / 单条添加都会触发）
- \`post.analyzed\` 作品分析完成
- \`user.added\` 新作者入库（已存在的不会再触发）
- \`live.converted\` 直播 FLV 转成 MP4 之后

\`post.downloaded\` 的 event：

\`\`\`js
event.hook            // 固定 'post.downloaded'，用来和手动运行区分
event.source          // 'task' 下载任务 / 'sync' 用户同步 / 'single' 单条添加
event.folderPath      // 本地文件夹绝对路径，视频/封面/文案都在里面
event.post.id         // 数据库主键，打标签用
event.post.awemeId    // 抖音作品 id
event.post.userId     // 作者本地 id
event.post.secUid     // 作者 sec_uid，也是下载目录第一层
event.post.nickname   // 下载当时的昵称
event.post.folderName // 作品文件夹名，一般等于 awemeId
event.post.desc       // 文案
event.post.awemeType  // 0 = 视频，其它 = 图文
// tags / category / summary 等分析字段此时通常为空
\`\`\`

\`post.analyzed\` 的 \`event.post\` 形状相同，但 tags、category、summary、scene、contentLevel 已填上。

\`user.added\`：\`event.user.id / secUid / uid / nickname / uniqueId\`（已存在的作者不会再触发）。

\`live.converted\`：\`event.record.id / userId / nickname / roomId / filePath / fileSize\`，此时 filePath 已是 mp4。

钩子默认 10 分钟超时，和手动运行共用「同一脚本不能并发」：新事件排队，点停止会清队列。
详情页可以暂停钩子而不改代码。手动运行时 event 为空。

## api.log / api.sleep

\`api.log(...args)\` 输出到页面的运行面板。非字符串参数会被格式化展开。

\`await api.sleep(ms)\` 暂停指定毫秒数，用于给连续请求之间加间隔避免风控。

## 停止脚本

页面上的「停止」按钮是**协作式**的：JS 无法强行中断执行中的代码，只能在脚本
交出控制权时中断。具体会在这些时机停下：

- \`await api.sleep(...)\` 等待中 —— 立即中断
- 下一次调用任意 \`api.*\` 方法时 —— 抛出中断错误

所以长时间的**纯计算**循环（不调 api、不 await）停不下来，需要自己检查：

\`\`\`js
for (const item of hugeList) {
  api.throwIfCancelled()   // 已请求停止则抛出，终止脚本
  // 或者: if (api.cancelled) break
  heavyComputation(item)
}
\`\`\`

如果脚本用 try/catch 包了 api 调用，记得让中断穿过去，别当成业务失败：

\`\`\`js
try {
  await api.actions.syncUser(id)
} catch (e) {
  if (api.cancelled) throw e   // 停止不算失败
  api.log('同步失败：' + e.message)
}
\`\`\`

## 长时间运行

脚本**默认不限时长**，跑几十小时也不会被中断，靠「停止」按钮手动收尾。

需要保险的脚本可以自己设超时：

\`\`\`js
exports.meta = { name: '...', timeout: 2 * 60 * 60 * 1000 }  // 2 小时后自动中断
\`\`\`

超时走的是和「停止」同一套 abort 机制，所以同样要求脚本会交出控制权。
纯计算死循环既停不掉也超时不了，长循环记得插 \`api.throwIfCancelled()\`。

注意应用退出会一并结束运行中的脚本。运行日志写在用户数据目录的 \`script-logs/\`，
每个脚本的留存条数可在「输出」里单独设（默认 1000）。关掉应用再打开还在。
点「清空」或删除脚本会去掉对应文件。

钩子脚本执行失败后，页面「再次运行」会用上次的 event 再跑一次。

## api.db — 数据库

\`\`\`js
api.db.query(sql, params?)   // 只读查询，仅允许 SELECT / WITH
api.db.exec(sql, params?)    // 写入，返回 { changes, lastInsertRowid }

api.db.users.list()
api.db.users.getById(id)
api.db.users.getBySecUid(secUid)
api.db.users.updateSettings(id, patch)  // patch 可含 max_download_count、auto_sync、
                                        // sync_cron、remark、show_in_home、
                                        // live_record、live_check_cron
api.db.users.delete(id)

api.db.posts.listByUserId(userId)
api.db.posts.getById(id)
api.db.posts.getByAwemeId(awemeId)
api.db.posts.setTags(id, { aiTags, manualTags })
api.db.posts.delete(id)

api.db.tags.all()
api.db.tags.rename(oldName, newName)
api.db.tags.merge(names, into)
api.db.tags.delete(names)
api.db.tags.addToPosts(postIds, tags)

api.db.settings.get(key)
api.db.settings.set(key, value)
\`\`\`

主要表：\`users\`、\`posts\`、\`download_tasks\`、\`task_users\`、\`settings\`、\`live_records\`。
\`posts\` 常用字段：\`id\`、\`aweme_id\`、\`user_id\`、\`sec_uid\`、\`nickname\`、\`desc\`、
\`folder_name\`、\`video_path\`、\`cover_path\`、\`downloaded_at\`、\`analysis_tags\`、\`manual_tags\`。

## api.actions — 业务操作

\`\`\`js
await api.actions.addUser(url)            // 主页/作品链接添加用户
await api.actions.addVideo(urlOrAwemeId)  // 添加单个作品，可直接传 aweme_id
await api.actions.syncUser(userId)        // 同步作品列表
await api.actions.runTask(taskId)         // 执行下载任务
await api.actions.analyze(secUid?)        // 分析未分析作品
await api.actions.reanalyzePosts(postIds) // 重新分析
\`\`\`

## api.douyin — 抖音只读接口

走应用里配置的 cookie 与签名。收藏相关接口没有用户参数，抖音按 cookie 判断「我」是谁，
拿到的都是当前登录账号自己的数据。翻页间隔内置 1.5 秒，点「停止」会立即中断。

\`\`\`js
await api.douyin.me()                     // { uid, uniqueId, loggedIn }
await api.douyin.video(urlOrAwemeId)      // 作品详情
await api.douyin.user(urlOrSecUid)        // 作者资料
await api.douyin.userVideos(secUid, 50)   // 作者作品列表，第二个参数是条数上限（0=不限）
await api.douyin.parseUrl(url)            // { type: 'user'|'video'|'unknown', id }
await api.douyin.collects()               // 收藏夹列表 [{ id, name, total }]
await api.douyin.collectsVideos(id)       // 某收藏夹的全部作品
await api.douyin.collectionVideos()       // 「收藏」里的全部作品
\`\`\`

作品列表类接口返回 \`[{ awemeId, desc, nickname, secUid, createTime }]\`，
\`createTime\` 是 Unix 秒。拿到 awemeId 后 \`await api.actions.addVideo(awemeId)\`
即可入库并下载，可参考内置脚本「同步收藏夹作品并下载」。

## api.fs — 文件系统

路径限制在**下载目录**和**用户数据目录**内，越界会抛错。

\`\`\`js
api.fs.downloadRoot      // 下载根目录绝对路径
api.fs.userDataRoot      // 用户数据目录绝对路径
api.fs.join(...segments) // 按当前系统的分隔符拼路径
api.fs.exists(path)
api.fs.list(dir)         // [{ name, path, isDirectory, size }]
api.fs.read(path)
api.fs.write(path, content)
api.fs.remove(path)      // 文件或整个目录
api.fs.move(from, to)
api.fs.mkdir(path)
\`\`\`

## api.shell — 执行本地命令

**需要在「设置 - 系统 - 允许脚本执行本地命令」里开启，默认关闭。**
开启后脚本能在这台电脑上执行任意命令，只在跑你信任的脚本时开。

\`\`\`js
api.shell.allowed                                  // 当前是否已开启

// run：不经过 shell，参数自动转义，不用自己加引号
await api.shell.run('python3', ['a.py', '--in', filePath])

// exec：走系统 shell，可用管道和重定向
await api.shell.exec('ffmpeg -i in.mp4 out.mp4')
\`\`\`

两者返回 \`{ ok, code, stdout, stderr, signal }\`，\`ok\` 即退出码为 0。
可选项：\`{ cwd, env, input, timeout, log }\`——\`cwd\` 默认脚本目录，
\`input\` 写入 stdin，\`log: true\` 把输出按行实时推到运行面板。

点「停止」会连子进程一起杀掉。应用从图形界面启动时 PATH 很短，
已自动补上 /opt/homebrew/bin、/usr/local/bin 等常见位置，仍找不到就写绝对路径。

## api.net — 网络请求

\`\`\`js
const res = await api.net.fetch(url, { method, headers, body })
// res = { status, ok, headers, body }
\`\`\`

## 示例：统计每个用户的作品数

\`\`\`js
exports.meta = { name: '用户作品数统计' }

exports.run = async (api) => {
  const rows = api.db.query(\`
    SELECT u.nickname, COUNT(p.id) AS cnt
    FROM users u LEFT JOIN posts p ON p.user_id = u.id
    GROUP BY u.id ORDER BY cnt DESC
  \`)
  rows.forEach((r) => api.log(\`\${r.nickname}: \${r.cnt}\`))
  return { users: rows.length }
}
\`\`\`
`
