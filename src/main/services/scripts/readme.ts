/**
 * 写入脚本目录的 API 参考。与 types.ts 的 ScriptApi 保持同步。
 */
export const SCRIPTS_README = `# 自定义脚本

把 \`.js\` 文件放进本目录，在应用「自定义脚本」页点「重新扫描」即可看到。

## 脚本结构

CommonJS 风格，必须导出 \`meta\` 和 \`run\`：

\`\`\`js
exports.meta = {
  name: '脚本名称',          // 必填
  description: '一句话说明', // 可选
  timeout: 0                 // 可选，执行超时（毫秒）。不填或 0 = 不限时长
}

exports.run = async (api) => {
  api.log('开始')
  // ...
  return { done: true }   // 返回值会显示在运行结果里（需 JSON 可序列化）
}
\`\`\`

脚本在 vm 沙箱里求值，**没有 \`require\`**，所有能力都通过 \`run(api)\` 的入参获得。
顶层代码在扫描列表时就会执行，所以顶层只做声明，实际逻辑写在 \`run\` 里。

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

注意应用退出会一并结束运行中的脚本，日志缓存也在内存里，不跨重启保留。

## api.db — 数据库

\`\`\`js
api.db.query(sql, params?)   // 只读查询，仅允许 SELECT / WITH
api.db.exec(sql, params?)    // 写入，返回 { changes, lastInsertRowid }

api.db.users.list()
api.db.users.getBySecUid(secUid)
api.db.users.updateSettings(id, patch)  // patch 可含 max_download_count、auto_sync、
                                        // sync_cron、remark、show_in_home、
                                        // live_record、live_check_cron
api.db.users.delete(id)

api.db.posts.listByUserId(userId)
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

主要表：\`users\`、\`posts\`、\`tasks\`、\`settings\`、\`live_records\`。
\`posts\` 常用字段：\`id\`、\`aweme_id\`、\`user_id\`、\`sec_uid\`、\`nickname\`、\`desc\`、
\`folder_name\`、\`video_path\`、\`cover_path\`、\`downloaded_at\`、\`analysis_tags\`、\`manual_tags\`。

## api.actions — 业务操作

\`\`\`js
await api.actions.addUser(url)            // 主页/作品链接添加用户
await api.actions.syncUser(userId)        // 同步作品列表
await api.actions.runTask(taskId)         // 执行下载任务
await api.actions.analyze(secUid?)        // 分析未分析作品
await api.actions.reanalyzePosts(postIds) // 重新分析
\`\`\`

## api.fs — 文件系统

路径限制在**下载目录**和**用户数据目录**内，越界会抛错。

\`\`\`js
api.fs.downloadRoot      // 下载根目录绝对路径
api.fs.userDataRoot      // 用户数据目录绝对路径
api.fs.exists(path)
api.fs.list(dir)         // [{ name, path, isDirectory, size }]
api.fs.read(path)
api.fs.write(path, content)
api.fs.remove(path)      // 文件或整个目录
api.fs.move(from, to)
api.fs.mkdir(path)
\`\`\`

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
