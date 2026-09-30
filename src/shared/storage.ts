/** 主进程与渲染层共享的对象存储类型 */

/** keep：本地全留；covers：上云并核对通过、过了保留期后本地只留封面 */
export type LocalPolicy = 'keep' | 'covers'

export interface StorageConfigView {
  enabled: boolean
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  /** 密钥不回传渲染层，只告诉它有没有配过 */
  hasSecretAccessKey: boolean
  /** 可选：公开访问域名（CDN / 自定义域名），配了就不再预签名 */
  publicBaseUrl: string
  /** 可选：上传中转，契约 PUT <relayUrl>/r2?url=<预签名地址> */
  relayUrl: string
  hasRelayToken: boolean
  concurrency: number
  localPolicy: LocalPolicy
  /** 上云后多少天再清理本地 */
  graceDays: number
  /** 从云端取回原文件（AI 分析等）的本地缓存上限 */
  cacheGb: number
}

export interface StorageConfigInput {
  enabled: boolean
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  /** 留空表示不修改已保存的密钥 */
  secretAccessKey?: string
  publicBaseUrl: string
  relayUrl: string
  /** 留空表示不修改 */
  relayToken?: string
  concurrency: number
  localPolicy: LocalPolicy
  graceDays: number
  cacheGb: number
}

export interface StorageQueueStats {
  queued: number
  running: number
  failed: number
  syncedPosts: number
  syncedBytes: number
  totalPosts: number
  /** 本地已清理、只剩云端的作品数 */
  cloudOnlyPosts: number
  recentErrors: { awemeId: string; error: string }[]
}

export interface MigrationStatus {
  /** 正在跑的作业；null 表示空闲 */
  task: 'verify' | 'prune' | null
  phase: string
  done: number
  total: number
  /** 上一次作业的结果 / 错误 */
  result: string | null
  error: string | null
  /** 最近一次核对列出的桶清单有多旧；没核对过为 null。批量清理要求 30 分钟内 */
  snapshotAgeMs?: number | null
}

export interface PrunePreview {
  candidates: number
  /** 三方核对通过、可以清理的作品数 */
  eligible: number
  /** 没通过核对、不会删的作品数 */
  blocked: number
  bytes: number
  /** 这批里最晚一个作品的下载时间（unix 秒） */
  lastDownloadedAt: number | null
}

export interface StorageTestResult {
  ok: boolean
  message: string
}
