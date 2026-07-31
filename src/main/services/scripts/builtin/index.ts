import checkMissingFiles from './check-missing-files'
import syncAllThenLimit from './sync-all-then-limit'
import type { ScriptModule } from '../types'

/**
 * 内置脚本注册表。键即脚本 id 的后半段（builtin:<key>），新增脚本在此登记。
 */
export const builtinScripts: Record<string, ScriptModule> = {
  'check-missing-files': checkMissingFiles,
  'sync-all-then-limit': syncAllThenLimit
}
