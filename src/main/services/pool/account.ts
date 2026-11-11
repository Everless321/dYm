/** 共享计划的开关和账号绑定。登录令牌存在 settings 的 pool_token */
import { getSetting, setSetting } from '../../database'
import type { PoolStatus } from '../../../shared/pool'
import { PoolError, poolApi } from './client'

const normEmail = (email: string): string => email.trim().toLowerCase()

export async function getPoolStatus(): Promise<PoolStatus> {
  const token = getSetting('pool_token') || ''
  const status: PoolStatus = {
    enabled: getSetting('pool_enabled') === 'true',
    loggedIn: !!token,
    email: getSetting('pool_email') || '',
    credits: null,
    uploads: null,
    error: null
  }
  if (!token) return status
  try {
    const me = await poolApi.me(token)
    status.credits = me.credits
    status.uploads = me.uploads
  } catch (error) {
    // 令牌失效就清掉，让设置页回到登录表单
    if (error instanceof PoolError && error.status === 401) {
      setSetting('pool_token', '')
      status.loggedIn = false
    }
    status.error = (error as Error).message
  }
  return status
}

/** 只有登录后才能打开 */
export async function setPoolEnabled(enabled: boolean): Promise<PoolStatus> {
  if (enabled && !getSetting('pool_token')) throw new Error('请先注册或登录共享池账号')
  setSetting('pool_enabled', enabled ? 'true' : 'false')
  return getPoolStatus()
}

export async function sendPoolCode(email: string): Promise<void> {
  await poolApi.sendCode(normEmail(email))
}

async function bind(email: string, token: string): Promise<PoolStatus> {
  setSetting('pool_email', email)
  setSetting('pool_token', token)
  // 注册或登录就是要加入，直接打开开关
  setSetting('pool_enabled', 'true')
  return getPoolStatus()
}

export async function registerPool(
  email: string,
  password: string,
  code: string
): Promise<PoolStatus> {
  const e = normEmail(email)
  const { token } = await poolApi.register(e, password, code.trim())
  return bind(e, token)
}

export async function loginPool(email: string, password: string): Promise<PoolStatus> {
  const e = normEmail(email)
  const { token } = await poolApi.login(e, password)
  return bind(e, token)
}

/** 退出登录同时退出共享计划 */
export async function logoutPool(): Promise<PoolStatus> {
  setSetting('pool_token', '')
  setSetting('pool_enabled', 'false')
  return getPoolStatus()
}
