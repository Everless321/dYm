import { registerSettingsIpc } from './settings'
import { registerUserIpc } from './users'
import { registerTaskIpc } from './tasks'
import { registerPostIpc } from './posts'
import { registerVideoIpc } from './video'
import { registerLiveIpc } from './live'
import { registerAnalysisIpc } from './analysis'
import { registerScriptsIpc } from './scripts'
import { registerSystemIpc } from './system'

/** 注册全部 IPC handler。按领域拆分在同目录各文件里，须在 app ready 之后调用 */
export function registerIpcHandlers(): void {
  registerSettingsIpc()
  registerUserIpc()
  registerTaskIpc()
  registerPostIpc()
  registerVideoIpc()
  registerLiveIpc()
  registerAnalysisIpc()
  registerScriptsIpc()
  registerSystemIpc()
}
