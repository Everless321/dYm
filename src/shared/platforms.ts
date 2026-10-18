/**
 * 创作者平台。添加时按链接自动识别，各平台保存各自的设置。
 * 哔哩哔哩的画质 / 编码选项与 downkyicore 的播放参数对齐。
 */

export const CREATOR_PLATFORMS = ['douyin', 'bilibili'] as const
export type CreatorPlatform = (typeof CREATOR_PLATFORMS)[number]

export const CREATOR_PLATFORM_LABEL: Record<CreatorPlatform, string> = {
  douyin: '抖音',
  bilibili: '哔哩哔哩'
}

export interface BilibiliCreatorSettings {
  /** 期望画质 qn，拿不到时退到不超过它的最高一档 */
  videoQuality: number
  videoCodec: BilibiliVideoCodec
  /** 期望音质 id */
  audioQuality: number
  downloadVideo: boolean
  downloadAudio: boolean
  downloadDanmaku: boolean
  downloadSubtitle: boolean
  downloadCover: boolean
  /** 多分 P 时下载全部分 P；关闭则只下链接指定的 P，空间同步下第一 P */
  downloadAllPages: boolean
}

export type BilibiliVideoCodec = 'avc' | 'hevc' | 'av1'

export const BILIBILI_VIDEO_QUALITIES: { id: number; label: string }[] = [
  { id: 16, label: '360P' },
  { id: 32, label: '480P' },
  { id: 64, label: '720P' },
  { id: 80, label: '1080P' },
  { id: 112, label: '1080P+' },
  { id: 116, label: '1080P 60帧' },
  { id: 120, label: '4K' },
  { id: 125, label: 'HDR' },
  { id: 126, label: '杜比视界' },
  { id: 127, label: '8K' }
]

export const BILIBILI_CODECS: { id: BilibiliVideoCodec; label: string; codecId: number }[] = [
  { id: 'avc', label: 'H.264 / AVC', codecId: 7 },
  { id: 'hevc', label: 'H.265 / HEVC', codecId: 12 },
  { id: 'av1', label: 'AV1', codecId: 13 }
]

export const BILIBILI_AUDIO_QUALITIES: { id: number; label: string }[] = [
  { id: 30216, label: '64K' },
  { id: 30232, label: '132K' },
  { id: 30280, label: '192K' },
  { id: 30250, label: 'Hi-Res' },
  { id: 30251, label: '杜比全景声' }
]

export const BILIBILI_CODEC_ID: Record<BilibiliVideoCodec, number> = {
  avc: 7,
  hevc: 12,
  av1: 13
}

export function defaultBilibiliCreatorSettings(): BilibiliCreatorSettings {
  return {
    videoQuality: 80,
    videoCodec: 'avc',
    audioQuality: 30280,
    downloadVideo: true,
    downloadAudio: true,
    downloadDanmaku: false,
    downloadSubtitle: false,
    downloadCover: true,
    downloadAllPages: false
  }
}

export function normalizeCreatorPlatform(value: unknown): CreatorPlatform {
  return value === 'bilibili' ? 'bilibili' : 'douyin'
}

export function bilibiliSecUid(mid: number): string {
  return `bili_${mid}`
}

export function normalizeBilibiliCreatorSettings(input: unknown): BilibiliCreatorSettings {
  const defaults = defaultBilibiliCreatorSettings()
  const raw = asRecord(input) ?? {}
  return {
    videoQuality: oneOf(
      raw.videoQuality,
      BILIBILI_VIDEO_QUALITIES.map((item) => item.id),
      defaults.videoQuality
    ),
    videoCodec: isCodec(raw.videoCodec) ? raw.videoCodec : defaults.videoCodec,
    audioQuality: oneOf(
      raw.audioQuality,
      BILIBILI_AUDIO_QUALITIES.map((item) => item.id),
      defaults.audioQuality
    ),
    downloadVideo: boolOr(raw.downloadVideo, defaults.downloadVideo),
    downloadAudio: boolOr(raw.downloadAudio, defaults.downloadAudio),
    downloadDanmaku: boolOr(raw.downloadDanmaku, defaults.downloadDanmaku),
    downloadSubtitle: boolOr(raw.downloadSubtitle, defaults.downloadSubtitle),
    downloadCover: boolOr(raw.downloadCover, defaults.downloadCover),
    downloadAllPages: boolOr(raw.downloadAllPages, defaults.downloadAllPages)
  }
}

export function parseBilibiliCreatorSettings(
  raw: string | null | undefined
): BilibiliCreatorSettings {
  if (!raw) return defaultBilibiliCreatorSettings()
  try {
    return normalizeBilibiliCreatorSettings(JSON.parse(raw))
  } catch {
    return defaultBilibiliCreatorSettings()
  }
}

export interface AddCreatorOptions {
  max_download_count?: number
  show_in_home?: boolean
  auto_sync?: boolean
  sync_cron?: string
  live_record?: boolean
  live_check_cron?: string
  platform_settings?: BilibiliCreatorSettings
}

/** 丢掉未知字段，把数字和 Cron 收到可入库的范围。无效 Cron 留空，由调用方决定要不要报错。 */
export function sanitizeAddCreatorOptions(input: unknown): AddCreatorOptions | undefined {
  const raw = asRecord(input)
  if (!raw) return undefined
  const options: AddCreatorOptions = {}
  if (raw.max_download_count !== undefined || raw.maxDownloadCount !== undefined) {
    options.max_download_count = clampCount(raw.max_download_count ?? raw.maxDownloadCount)
  }
  if (typeof raw.show_in_home === 'boolean') options.show_in_home = raw.show_in_home
  if (typeof raw.showInHome === 'boolean') options.show_in_home = raw.showInHome
  if (typeof raw.auto_sync === 'boolean') options.auto_sync = raw.auto_sync
  if (typeof raw.autoSync === 'boolean') options.auto_sync = raw.autoSync
  const cron = typeof raw.sync_cron === 'string' ? raw.sync_cron : raw.syncCron
  if (typeof cron === 'string') options.sync_cron = cron.trim().slice(0, 100)
  if (typeof raw.live_record === 'boolean') options.live_record = raw.live_record
  if (typeof raw.liveRecord === 'boolean') options.live_record = raw.liveRecord
  const liveCron = typeof raw.live_check_cron === 'string' ? raw.live_check_cron : raw.liveCheckCron
  if (typeof liveCron === 'string') options.live_check_cron = liveCron.trim().slice(0, 100)
  if (raw.platform_settings !== undefined || raw.bilibili !== undefined) {
    options.platform_settings = normalizeBilibiliCreatorSettings(
      raw.platform_settings ?? raw.bilibili
    )
  }
  return options
}

/**
 * 从一段分享文案里抽出创作者链接，并判断平台。
 * 识别规则对齐抖音分享域名，以及 downkyicore ParseEntrance 支持的 B 站空间 / 视频 / 短链。
 */
export function extractCreatorLink(
  text: string
): { platform: CreatorPlatform; url: string } | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const urlMatch = trimmed.match(/https?:\/\/[^\s<>"'，。]+/i)
  const candidate = (urlMatch ? urlMatch[0] : trimmed).replace(/[),.;，。]+$/g, '')
  const platform = detectCreatorPlatform(candidate)
  if (!platform) return null
  return { platform, url: candidate }
}

export function detectCreatorPlatform(input: string): CreatorPlatform | null {
  const text = input.trim()
  if (!text) return null
  if (/bilibili\.com|b23\.tv|bili2233\.cn/i.test(text)) return 'bilibili'
  if (/^BV[0-9A-Za-z]{10}$/.test(text)) return 'bilibili'
  if (/^av\d+$/i.test(text)) return 'bilibili'
  if (/^uid:?\d+$/i.test(text)) return 'bilibili'
  if (/douyin\.com|iesdouyin\.com/i.test(text)) return 'douyin'
  return null
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  return input as Record<string, unknown>
}

function oneOf(value: unknown, allowed: number[], fallback: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return allowed.includes(parsed) ? parsed : fallback
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function isCodec(value: unknown): value is BilibiliVideoCodec {
  return value === 'avc' || value === 'hevc' || value === 'av1'
}

function clampCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(100_000, Math.floor(parsed)))
}
