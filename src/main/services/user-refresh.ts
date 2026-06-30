import { getUserById, updateUser, getSetting, type DbUser, type CreateUserInput } from '../database'
import { fetchUserProfileSmart } from './douyin'
import { downloadAvatar } from './avatar'

export type RefreshStatus = 'success' | 'degraded' | 'failed'

export interface RefreshOutcome {
  status: RefreshStatus
  user?: DbUser
  error?: string
}

// 批量刷新的限速：串行 + 每次间隔 base 毫秒 + 随机抖动，规避抖音风控。
// 可通过设置项 batch_refresh_delay 调整 base（毫秒），默认 2000。
const DEFAULT_BATCH_DELAY = 2000
const BATCH_JITTER = 1500

export function getBatchRefreshDelay(): number {
  const raw = getSetting('batch_refresh_delay')
  const base = raw ? parseInt(raw, 10) : NaN
  const safeBase = Number.isFinite(base) && base >= 0 ? base : DEFAULT_BATCH_DELAY
  return safeBase + Math.floor(Math.random() * BATCH_JITTER)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 判断抓取到的资料是否「降级」——疑似被封号或临时冻结。
 * 这类账号昵称通常会丢失，变成抖音号或纯数字，头像也会变成默认图。
 * 命中时需保留原有昵称与头像，避免把正常数据覆盖掉。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isDegradedProfile(fetched: any): boolean {
  const name = (fetched?.nickname || '').trim()
  if (!name) return true // 昵称为空
  if (/^\d+$/.test(name)) return true // 纯数字
  const uniqueId = (fetched?.unique_id || '').trim()
  if (uniqueId && name === uniqueId) return true // 昵称变成抖音号
  return false
}

/**
 * 刷新单个用户资料。正常账号更新全部字段并下载头像；
 * 降级账号（疑似封号/冻结）保留原昵称与头像，仅更新统计等其它字段。
 */
export async function refreshUserProfile(id: number): Promise<RefreshOutcome> {
  const existing = getUserById(id)
  if (!existing) return { status: 'failed', error: '用户不存在' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetched: any
  try {
    const profileRes = await fetchUserProfileSmart(existing.homepage_url)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetched = (profileRes as any)._data?.user
  } catch (error) {
    return { status: 'failed', error: (error as Error).message }
  }
  if (!fetched) return { status: 'failed', error: '获取用户信息失败' }

  // 统计类字段无论是否降级都更新
  const update: Partial<CreateUserInput> = {
    signature: fetched.signature,
    following_count: fetched.following_count,
    follower_count: fetched.follower_count,
    total_favorited: fetched.total_favorited,
    aweme_count: fetched.aweme_count
  }

  if (isDegradedProfile(fetched)) {
    // 保留原昵称与头像：不写 nickname / avatar / avatar_path
    const user = updateUser(id, update)
    return { status: 'degraded', user }
  }

  // 正常账号：更新昵称 + 头像
  update.nickname = fetched.nickname
  const avatarUrl =
    fetched.avatar_larger?.url_list?.[0] || fetched.avatar_medium?.url_list?.[0] || ''
  if (avatarUrl) {
    update.avatar = avatarUrl
    // 头像下载失败不影响其它字段更新（downloadAvatar 内部已吞错返回 null）
    const avatarPath = await downloadAvatar(fetched.sec_uid, avatarUrl)
    if (avatarPath) update.avatar_path = avatarPath
  }
  const user = updateUser(id, update)
  return { status: 'success', user }
}
