import checkMissingFiles from './check-missing-files.js?raw'
import syncAllThenLimit from './sync-all-then-limit.js?raw'
import syncCollects from './sync-collects.js?raw'
import logNewDownloads from './log-new-downloads.js?raw'

/**
 * 内置脚本注册表。键即脚本 id 的后半段（builtin:<key>），新增脚本在此登记。
 *
 * 内置脚本以源码字符串编译进包，与外部脚本走同一套 vm 运行时——
 * 这样「查看源码」看到的就是真正在跑的代码，「以此为模板新建」也是逐字复制。
 */
export const builtinSources: Record<string, string> = {
  'check-missing-files': checkMissingFiles,
  'sync-all-then-limit': syncAllThenLimit,
  'sync-collects': syncCollects,
  'log-new-downloads': logNewDownloads
}
