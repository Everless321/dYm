/** 共享计划（dym-pool）在设置页展示的状态，不带登录令牌 */
export interface PoolStatus {
  enabled: boolean
  loggedIn: boolean
  email: string
  credits: number | null
  uploads: number | null
  /** 拉取账号信息失败时的原因（如登录过期） */
  error: string | null
}
