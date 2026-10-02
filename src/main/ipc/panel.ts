import { ipcMain } from 'electron'
import { applyPanelRuntime, getPanelRuntimeStatus, issueLocalKey } from '../services/panel/host'

export function registerPanelIpc(): void {
  ipcMain.handle('panel:status', () => getPanelRuntimeStatus())
  ipcMain.handle('panel:apply', () => applyPanelRuntime())
  ipcMain.handle('panel:issueLocalKey', () => issueLocalKey())
}
