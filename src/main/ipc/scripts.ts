import { ipcMain, shell } from 'electron'
import {
  getScriptSchedules,
  setScriptSchedule,
  deleteScriptSchedule,
  renameScriptSchedule,
  isScriptHookEnabled,
  setScriptHookEnabled,
  deleteScriptHookSetting,
  renameScriptHookSetting,
  setScriptLogLimit,
  deleteScriptLogSetting,
  renameScriptLogSetting
} from '../database'
import {
  validateCronExpression,
  rescheduleScript,
  unscheduleScript,
  getScriptNextRun
} from '../services/scheduler'
import { ensureScriptsDir, getScriptSource, listScripts } from '../services/scripts/loader'
import {
  applyScriptLogLimit,
  clearScriptLogs,
  getRunningScripts,
  getScriptLogs,
  renameScriptLogs,
  runScript,
  stopScript
} from '../services/scripts/runner'
import {
  rebuildScriptHookIndex,
  syncScriptHookIndex,
  dropScriptHookIndex,
  clearScriptHookQueue
} from '../services/scripts/hooks'
import type { ScriptHookName } from '../services/scripts/types'
import {
  buildScriptTemplate,
  createScript,
  deleteScript,
  renameScript,
  saveScript
} from '../services/scripts/store'

export function registerScriptsIpc(): void {
  // 自定义脚本（开发者模式）
  ipcMain.handle('scripts:list', () => {
    const list = listScripts()
    rebuildScriptHookIndex(list)
    return list
  })
  ipcMain.handle('scripts:run', (_event, id: string) => runScript(id))
  ipcMain.handle('scripts:stop', (_event, id: string) => {
    clearScriptHookQueue(id)
    return stopScript(id)
  })
  ipcMain.handle('scripts:running', () => getRunningScripts())
  ipcMain.handle('scripts:getLogs', (_event, id: string) => getScriptLogs(id))
  ipcMain.handle('scripts:clearLogs', (_event, id: string) => clearScriptLogs(id))
  ipcMain.handle('scripts:getDir', () => ensureScriptsDir())
  ipcMain.handle('scripts:openDir', () => {
    shell.openPath(ensureScriptsDir())
  })

  // 应用内编辑：读源码 / 新建 / 保存 / 重命名 / 删除
  ipcMain.handle('scripts:read', (_event, id: string) => getScriptSource(id))
  ipcMain.handle('scripts:template', (_event, name: string, hook?: ScriptHookName | null) =>
    buildScriptTemplate(name, hook)
  )
  ipcMain.handle('scripts:create', (_event, fileName: string, source: string) => {
    const descriptor = createScript(fileName, source)
    syncScriptHookIndex(descriptor)
    return descriptor
  })
  ipcMain.handle('scripts:save', (_event, fileName: string, source: string) => {
    const descriptor = saveScript(fileName, source)
    syncScriptHookIndex(descriptor)
    return descriptor
  })
  ipcMain.handle('scripts:rename', (_event, from: string, to: string) => {
    const descriptor = renameScript(from, to)
    // 计划挂在脚本 id 上，改名后得跟着搬，否则会留下一条指向不存在脚本的计划
    unscheduleScript(`external:${from}`)
    renameScriptSchedule(`external:${from}`, descriptor.id)
    rescheduleScript(descriptor.id)
    dropScriptHookIndex(`external:${from}`)
    renameScriptHookSetting(`external:${from}`, descriptor.id)
    // 先搬日志再搬留存设置：搬日志时要按旧 id 读留存条数，设置先搬走会退回默认值把历史裁掉
    renameScriptLogs(`external:${from}`, descriptor.id)
    renameScriptLogSetting(`external:${from}`, descriptor.id)
    syncScriptHookIndex(descriptor)
    return descriptor
  })
  ipcMain.handle('scripts:delete', (_event, fileName: string) => {
    deleteScript(fileName)
    unscheduleScript(`external:${fileName}`)
    deleteScriptSchedule(`external:${fileName}`)
    dropScriptHookIndex(`external:${fileName}`)
    deleteScriptHookSetting(`external:${fileName}`)
    deleteScriptLogSetting(`external:${fileName}`)
  })

  // 脚本定时执行
  ipcMain.handle('scripts:getSchedules', () =>
    getScriptSchedules().map((row) => ({
      scriptId: row.script_id,
      cron: row.cron,
      enabled: !!row.enabled,
      nextRun: getScriptNextRun(row.script_id)
    }))
  )
  ipcMain.handle(
    'scripts:setSchedule',
    (_event, scriptId: string, cron: string, enabled: boolean) => {
      const expression = cron.trim()
      // 关掉定时的时候允许留空表达式，开着就必须给出合法的 cron
      if (enabled && !validateCronExpression(expression)) {
        throw new Error(`Cron 表达式无效：${expression || '(空)'}`)
      }
      if (!enabled && !expression) {
        unscheduleScript(scriptId)
        deleteScriptSchedule(scriptId)
        return null
      }
      setScriptSchedule(scriptId, expression, enabled)
      rescheduleScript(scriptId)
      return {
        scriptId,
        cron: expression,
        enabled,
        nextRun: getScriptNextRun(scriptId)
      }
    }
  )

  ipcMain.handle('scripts:setHookEnabled', (_event, scriptId: string, enabled: boolean) => {
    setScriptHookEnabled(scriptId, enabled)
    if (!enabled) clearScriptHookQueue(scriptId)
    return isScriptHookEnabled(scriptId)
  })

  ipcMain.handle('scripts:setLogLimit', (_event, scriptId: string, limit: number) => {
    const logLimit = setScriptLogLimit(scriptId, limit)
    applyScriptLogLimit(scriptId, logLimit)
    return logLimit
  })
}
