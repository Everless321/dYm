import { existsSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { describeExternal, ensureScriptsDir, getScriptPath, getScriptsDir } from './loader'
import { clearScriptLogs, isScriptRunning } from './runner'
import type { ScriptDescriptor } from './types'

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

/** 新建脚本用的起手模板 */
export function buildScriptTemplate(name: string): string {
  const safeName = name.replace(/'/g, "\\'")
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
  // 文件没了，留着日志缓存只会占内存
  clearScriptLogs(`external:${name}`)
}
