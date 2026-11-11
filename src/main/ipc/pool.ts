import { ipcMain } from 'electron'
import {
  getPoolStatus,
  loginPool,
  logoutPool,
  registerPool,
  sendPoolCode,
  setPoolEnabled
} from '../services/pool/account'

export function registerPoolIpc(): void {
  ipcMain.handle('pool:status', () => getPoolStatus())
  ipcMain.handle('pool:setEnabled', (_event, enabled: boolean) => setPoolEnabled(enabled))
  ipcMain.handle('pool:sendCode', (_event, email: string) => sendPoolCode(email))
  ipcMain.handle('pool:register', (_event, email: string, password: string, code: string) =>
    registerPool(email, password, code)
  )
  ipcMain.handle('pool:login', (_event, email: string, password: string) =>
    loginPool(email, password)
  )
  ipcMain.handle('pool:logout', () => logoutPool())
}
