import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import vm from 'vm'
import { getScriptLogLimit, isScriptHookEnabled } from '../../database'
import { builtinSources } from './builtin'
import { hasLastHookEvent } from './log-store'
import { SCRIPTS_README } from './readme'
import {
  isScriptHookName,
  type ScriptDescriptor,
  type ScriptMeta,
  type ScriptModule
} from './types'

/** 外部脚本目录：<用户数据>/scripts */
export function getScriptsDir(): string {
  return join(app.getPath('userData'), 'scripts')
}

/** 确保脚本目录存在，并保证目录里有一份最新的 api 参考 */
export function ensureScriptsDir(): string {
  const dir = getScriptsDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  // README 随版本更新，每次都覆盖写入（只扫描 .js，不会被当成脚本）
  writeFileSync(join(dir, 'README.md'), SCRIPTS_README, 'utf-8')
  return dir
}

/** 外部脚本文件的绝对路径 */
export function getScriptPath(fileName: string): string {
  return join(getScriptsDir(), fileName)
}

function parseHook(
  meta: ScriptMeta,
  filename: string
): { meta: ScriptMeta; warning: string | null } {
  if (meta.hook === undefined) return { meta, warning: null }
  if (!isScriptHookName(meta.hook)) {
    const warning = `无法识别的 meta.hook「${String(meta.hook)}」，钩子未启用`
    console.warn(`[scripts] ${filename} ${warning}`)
    return { meta: { ...meta, hook: undefined }, warning }
  }
  return { meta, warning: null }
}

/** 把脚本源码当作 CommonJS 模块在 vm 里求值，取出 meta / run */
export function evaluateScript(code: string, filename: string): ScriptModule {
  const moduleShim = { exports: {} as Record<string, unknown> }
  const sandbox = {
    module: moduleShim,
    exports: moduleShim.exports,
    console,
    // 脚本能力一律走 run(api) 的入参，不开放 require
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder
  }

  vm.runInNewContext(code, vm.createContext(sandbox), { filename, timeout: 5000 })

  const exported = (moduleShim.exports ?? {}) as Partial<ScriptModule>
  if (typeof exported.run !== 'function') {
    throw new Error('脚本必须导出 run 函数：exports.run = async (api, event) => {}')
  }
  if (!exported.meta || typeof exported.meta.name !== 'string' || !exported.meta.name.trim()) {
    throw new Error('脚本必须导出 meta 且包含 name：exports.meta = { name: "..." }')
  }
  const parsed = parseHook(exported.meta, filename)
  return {
    meta: parsed.meta,
    run: exported.run,
    hookWarning: parsed.warning ?? undefined
  }
}

/** 取脚本源码。内置脚本读编译进包的字符串，外部脚本读磁盘文件 */
export function getScriptSource(id: string): string {
  if (id.startsWith('builtin:')) {
    const key = id.slice('builtin:'.length)
    const source = builtinSources[key]
    if (source === undefined) throw new Error(`内置脚本不存在：${key}`)
    return source
  }
  if (id.startsWith('external:')) {
    const filePath = getScriptPath(id.slice('external:'.length))
    if (!existsSync(filePath)) throw new Error(`脚本文件不存在：${filePath}`)
    return readFileSync(filePath, 'utf-8')
  }
  throw new Error(`无法识别的脚本 id：${id}`)
}

/** 加载单个脚本模块，id 为 list() 返回的 id */
export function loadScript(id: string): ScriptModule {
  return evaluateScript(getScriptSource(id), id)
}

/** 生成一条列表条目，求值失败时保留条目并附带错误原因 */
function describe(id: string, fileName: string | null): ScriptDescriptor {
  const base = {
    id,
    source: (fileName === null ? 'builtin' : 'external') as ScriptDescriptor['source'],
    fileName,
    filePath: fileName === null ? null : getScriptPath(fileName),
    hook: null as ScriptDescriptor['hook'],
    hookEnabled: isScriptHookEnabled(id),
    hookWarning: null as string | null,
    logLimit: getScriptLogLimit(id),
    hasLastHookEvent: hasLastHookEvent(id)
  }
  try {
    const { meta, hookWarning } = loadScript(id)
    return {
      ...base,
      name: meta.name,
      description: meta.description ?? '',
      error: null,
      hook: meta.hook ?? null,
      hookWarning: hookWarning ?? null
    }
  } catch (error) {
    return {
      ...base,
      name: fileName ?? id,
      description: '',
      error: (error as Error).message
    }
  }
}

/** 列出脚本目录里的 .js 文件名 */
export function listScriptFiles(): string[] {
  return readdirSync(ensureScriptsDir(), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name)
    .sort()
}

/** 单个外部脚本的列表条目，写入后回传给渲染层用 */
export function describeExternal(fileName: string): ScriptDescriptor {
  return describe(`external:${fileName}`, fileName)
}

/** 列出全部脚本；加载失败时保留条目并附带错误原因 */
export function listScripts(): ScriptDescriptor[] {
  const builtin = Object.keys(builtinSources).map((key) => describe(`builtin:${key}`, null))
  const external = listScriptFiles().map(describeExternal)
  return [...builtin, ...external]
}
