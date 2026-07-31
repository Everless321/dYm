import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import vm from 'vm'
import { builtinScripts } from './builtin'
import { SCRIPTS_README } from './readme'
import type { ScriptDescriptor, ScriptModule } from './types'

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

/** 把外部 .js 文件当作 CommonJS 模块在 vm 里求值，取出 meta / run */
function loadExternalModule(filePath: string): ScriptModule {
  const code = readFileSync(filePath, 'utf-8')
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

  vm.runInNewContext(code, vm.createContext(sandbox), { filename: filePath, timeout: 5000 })

  const exported = (moduleShim.exports ?? {}) as Partial<ScriptModule>
  if (typeof exported.run !== 'function') {
    throw new Error('脚本必须导出 run 函数：exports.run = async (api) => {}')
  }
  if (!exported.meta || typeof exported.meta.name !== 'string' || !exported.meta.name.trim()) {
    throw new Error('脚本必须导出 meta 且包含 name：exports.meta = { name: "..." }')
  }
  return { meta: exported.meta, run: exported.run }
}

/** 加载单个脚本模块，id 为 list() 返回的 id */
export function loadScript(id: string): ScriptModule {
  if (id.startsWith('builtin:')) {
    const key = id.slice('builtin:'.length)
    const script = builtinScripts[key]
    if (!script) throw new Error(`内置脚本不存在：${key}`)
    return script
  }
  if (id.startsWith('external:')) {
    const fileName = id.slice('external:'.length)
    const filePath = join(getScriptsDir(), fileName)
    if (!existsSync(filePath)) throw new Error(`脚本文件不存在：${filePath}`)
    return loadExternalModule(filePath)
  }
  throw new Error(`无法识别的脚本 id：${id}`)
}

/** 列出全部脚本；外部脚本加载失败时保留条目并附带错误原因 */
export function listScripts(): ScriptDescriptor[] {
  const builtin: ScriptDescriptor[] = Object.entries(builtinScripts).map(([key, script]) => ({
    id: `builtin:${key}`,
    source: 'builtin',
    name: script.meta.name,
    description: script.meta.description ?? '',
    filePath: null,
    error: null
  }))

  const dir = ensureScriptsDir()
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name)
    .sort()

  const external: ScriptDescriptor[] = files.map((fileName) => {
    const filePath = join(dir, fileName)
    try {
      const { meta } = loadExternalModule(filePath)
      return {
        id: `external:${fileName}`,
        source: 'external',
        name: meta.name,
        description: meta.description ?? '',
        filePath,
        error: null
      }
    } catch (error) {
      return {
        id: `external:${fileName}`,
        source: 'external',
        name: fileName,
        description: '',
        filePath,
        error: (error as Error).message
      }
    }
  })

  return [...builtin, ...external]
}
