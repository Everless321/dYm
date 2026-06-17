import { getSetting } from '../database'

export interface CollectItem {
  aweme_id: string
  action?: number
  aweme_type?: number
  ts?: number
}

export const DEFAULT_COLLECT_BASE_URL = 'https://dymserver.everless.app'
export const DEFAULT_COLLECT_CRON = '*/30 * * * *'

export function isCollectSyncEnabled(): boolean {
  return getSetting('collect_sync_enabled') === 'true'
}

export function getCollectCron(): string {
  return getSetting('collect_sync_cron') || DEFAULT_COLLECT_CRON
}

/**
 * 拉取并清空收藏暂存服务的队列。
 * 调用 `GET {base}/pull?token=xxx`，返回去重后的 aweme_id 记录列表。
 * 配置缺失或请求失败会抛出错误，交由调用方记录日志。
 */
export async function pullCollectedItems(): Promise<CollectItem[]> {
  const baseUrl = (getSetting('collect_sync_base_url') || DEFAULT_COLLECT_BASE_URL).trim()
  const token = (getSetting('collect_sync_token') || '').trim()

  if (!baseUrl) {
    throw new Error('未配置收藏服务器地址')
  }
  if (!token) {
    throw new Error('未配置收藏服务 token')
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/pull?token=${encodeURIComponent(token)}`

  let res: Response
  try {
    res = await fetch(url, { method: 'GET' })
  } catch (error) {
    throw new Error(`无法连接收藏服务: ${(error as Error).message}`)
  }

  if (res.status === 401) {
    throw new Error('token 无效（401）')
  }
  if (!res.ok) {
    throw new Error(`收藏服务返回 ${res.status}`)
  }

  const data = (await res.json()) as { ok?: boolean; items?: CollectItem[]; error?: string }
  if (!data.ok) {
    throw new Error(data.error || '收藏服务返回失败')
  }

  return Array.isArray(data.items) ? data.items : []
}
