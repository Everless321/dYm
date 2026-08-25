import { existsSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { describeExternal, ensureScriptsDir, getScriptPath, getScriptsDir } from './loader'
import { forgetScriptRuntime, isScriptRunning } from './runner'
import type { ScriptDescriptor, ScriptHookName } from './types'

/** Windows 与 macOS 都不接受的文件名字符 */
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/

/** 文件名上限，够长又不至于撞上系统限制 */
const MAX_FILENAME_LENGTH = 100

/**
 * 校验脚本文件名：必须是脚本目录下的一个 .js 文件，不能借相对路径跑出去。
 * 返回规范化后的文件名。
 */
function assertValidFileName(fileName: string): string {
  const name = fileName.trim()
  if (!name) throw new Error('文件名不能为空')
  if (!name.endsWith('.js')) throw new Error('脚本文件名必须以 .js 结尾')
  if (name === '.js') throw new Error('文件名不能为空')
  if (name.startsWith('.')) throw new Error('脚本文件名不能以 . 开头')
  if (INVALID_FILENAME_CHARS.test(name)) {
    throw new Error('脚本文件名不能包含 \\ / : * ? " < > | 这些字符')
  }
  if (name.length > MAX_FILENAME_LENGTH) {
    throw new Error(`脚本文件名过长（最多 ${MAX_FILENAME_LENGTH} 个字符）`)
  }
  // 上面已排除分隔符，这里兜底确认解析结果确实落在脚本目录内
  const filePath = getScriptPath(name)
  if (resolve(dirname(filePath)) !== resolve(getScriptsDir())) {
    throw new Error(`脚本文件名不合法：${fileName}`)
  }
  return name
}

/** 运行中的脚本不允许改名或删除，否则日志与运行状态会对不上 */
function assertNotRunning(fileName: string): void {
  if (isScriptRunning(`external:${fileName}`)) {
    throw new Error(`「${fileName}」正在运行，请先停止再操作`)
  }
}

function escapeTemplateName(name: string): string {
  return name.replace(/'/g, "\\'")
}

/** 新建脚本用的起手模板。hook 在创建对话框里选好，写入 meta.hook，并把对应入参写进注释 */
export function buildScriptTemplate(name: string, hook?: ScriptHookName | null): string {
  const safeName = escapeTemplateName(name)
  if (!hook) {
    return `exports.meta = {
  name: '${safeName}',
  description: ''
  // timeout: 0   // 可选，执行超时（毫秒）。不填或 0 = 不限时长
}

exports.run = async (api) => {
  api.log('开始')

  // 在这里写逻辑。可用能力见脚本目录里的 README.md，例如：
  // const users = api.db.users.list()
  // await api.actions.syncUser(users[0].id)

  return { done: true }
}
`
  }

  if (hook === 'post.downloaded') {
    return `exports.meta = {
  name: '${safeName}',
  description: '每个作品下载完成后自动运行',
  hook: 'post.downloaded'
  // timeout: 10 * 60 * 1000  // 钩子默认 10 分钟；填 0 = 不限
}

exports.run = async (api, event) => {
  // 手动点「运行」或 cron 时没有 event，不要往下读
  if (!event || event.hook !== 'post.downloaded') {
    api.log('这是「作品下载完成」钩子脚本，请等作品下完后自动触发。')
    return
  }

  const post = event.post
  const dir = event.folderPath
  // event.source     'task' 下载任务 / 'sync' 用户同步 / 'single' 单条添加
  // event.folderPath 本地文件夹绝对路径（视频/封面/文案都在里面）
  // post.id          数据库主键，打标签用 api.db.tags.addToPosts([post.id], ['待看'])
  // post.awemeId     抖音作品 id
  // post.userId      作者本地 id
  // post.secUid      作者 sec_uid，也是下载目录第一层文件夹名
  // post.nickname    下载当时的作者昵称
  // post.folderName  作品文件夹名，一般等于 awemeId
  // post.desc        作品文案
  // post.awemeType   0 = 视频，其它 = 图文
  // post.tags 等分析字段此时通常还是空的，要等「作品分析完成」
  api.log(post.nickname, post.awemeId, event.source)
  api.log(dir)
}
`
  }

  if (hook === 'post.analyzed') {
    return `exports.meta = {
  name: '${safeName}',
  description: '每个作品分析完成后自动运行',
  hook: 'post.analyzed'
  // timeout: 10 * 60 * 1000
}

exports.run = async (api, event) => {
  if (!event || event.hook !== 'post.analyzed') {
    api.log('这是「作品分析完成」钩子脚本，请等分析结束后自动触发。')
    return
  }

  const post = event.post
  // post.id / awemeId / userId / secUid / nickname / folderName / desc / awemeType
  // post.tags          AI 标签数组
  // post.manualTags    手打标签
  // post.category      主分类
  // post.summary       一句话摘要
  // post.scene         场景
  // post.contentLevel  内容分级数字
  api.log(post.nickname, post.awemeId, post.category, post.tags.join(', '))
}
`
  }

  if (hook === 'user.added') {
    return `exports.meta = {
  name: '${safeName}',
  description: '添加新作者后自动运行',
  hook: 'user.added'
  // timeout: 10 * 60 * 1000
}

exports.run = async (api, event) => {
  if (!event || event.hook !== 'user.added') {
    api.log('这是「新作者添加」钩子脚本，请等添加作者后自动触发。')
    return
  }

  const user = event.user
  // user.id        本地用户 id，改设置：api.db.users.updateSettings(user.id, { auto_sync: true })
  // user.secUid    抖音稳定身份
  // user.uid       抖音 uid，可能是空字符串
  // user.nickname  入库时的昵称
  // user.uniqueId  抖音号，可能是空字符串
  api.log('新作者', user.nickname, user.secUid)
}
`
  }

  return `exports.meta = {
  name: '${safeName}',
  description: '直播转成可播放 MP4 后自动运行',
  hook: 'live.converted'
  // timeout: 10 * 60 * 1000
}

exports.run = async (api, event) => {
  if (!event || event.hook !== 'live.converted') {
    api.log('这是「直播转封装完成」钩子脚本，请等录制转 MP4 后自动触发。')
    return
  }

  const rec = event.record
  // rec.id        录制记录主键
  // rec.userId    作者本地 id
  // rec.nickname  录制时昵称
  // rec.roomId    直播间房间号
  // rec.filePath  已经是 mp4 的绝对路径
  // rec.fileSize  字节
  api.log(rec.nickname, rec.filePath)
}
`
}

/**
 * 新建脚本文件。已存在同名文件时报错，避免误覆盖别人的脚本。
 */
export function createScript(fileName: string, source: string): ScriptDescriptor {
  const name = assertValidFileName(fileName)
  ensureScriptsDir()
  const filePath = getScriptPath(name)
  if (existsSync(filePath)) throw new Error(`已存在同名脚本：${name}`)
  writeFileSync(filePath, source, 'utf-8')
  return describeExternal(name)
}

/**
 * 保存脚本内容。允许保存语法有问题的草稿——返回的条目会带上 error，
 * 页面据此提示并禁用运行，而不是把用户写到一半的代码挡在外面。
 */
export function saveScript(fileName: string, source: string): ScriptDescriptor {
  const name = assertValidFileName(fileName)
  const filePath = getScriptPath(name)
  if (!existsSync(filePath)) throw new Error(`脚本文件不存在：${name}`)
  writeFileSync(filePath, source, 'utf-8')
  return describeExternal(name)
}

/** 重命名脚本文件 */
export function renameScript(fromFileName: string, toFileName: string): ScriptDescriptor {
  const from = assertValidFileName(fromFileName)
  const to = assertValidFileName(toFileName)
  if (from === to) return describeExternal(from)
  assertNotRunning(from)
  if (!existsSync(getScriptPath(from))) throw new Error(`脚本文件不存在：${from}`)
  if (existsSync(getScriptPath(to))) throw new Error(`已存在同名脚本：${to}`)
  renameSync(getScriptPath(from), getScriptPath(to))
  return describeExternal(to)
}

/** 删除脚本文件 */
export function deleteScript(fileName: string): void {
  const name = assertValidFileName(fileName)
  assertNotRunning(name)
  rmSync(getScriptPath(name), { force: true })
  forgetScriptRuntime(`external:${name}`)
}
