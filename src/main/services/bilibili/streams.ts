import { BILIBILI_CODEC_ID, type BilibiliVideoCodec } from '../../../shared/platforms'

export interface DashStream {
  id: number
  codecid?: number
  baseUrl?: string
  base_url?: string
  backupUrl?: string[]
  backup_url?: string[]
}

export interface DashPayload {
  video?: DashStream[]
  audio?: DashStream[]
  flac?: { audio?: DashStream | null }
  dolby?: { audio?: DashStream[] | DashStream | null }
}

export function streamUrl(stream: DashStream | null | undefined): string {
  if (!stream) return ''
  return stream.baseUrl || stream.base_url || ''
}

/** 主地址在前，备用地址在后。主地址常是 PCDN 节点，卡住时换备用的 upos 源 */
export function streamUrls(stream: DashStream): string[] {
  return [streamUrl(stream), ...(stream.backupUrl ?? stream.backup_url ?? [])].filter(Boolean)
}

/**
 * 先定画质，再挑编码：取不超过目标画质的最高一档（quality 为 0 时不设上限），
 * 这一档里有偏好编码就用它，没有就用这一档的其他编码。
 */
export function pickVideoStream(
  streams: DashStream[] | undefined,
  quality: number,
  codec: BilibiliVideoCodec
): DashStream | null {
  const usable = (streams ?? []).filter((stream) => streamUrl(stream))
  const tier = pickClosest(usable, quality > 0 ? quality : Infinity)
  if (!tier) return null
  const sameTier = usable.filter((stream) => stream.id === tier.id)
  return sameTier.find((stream) => stream.codecid === BILIBILI_CODEC_ID[codec]) ?? tier
}

/**
 * Hi-Res / 杜比优先走 flac、dolby 节点，缺失时退回普通音轨。
 * quality 为 0（最高可用）时按 Hi-Res 处理：杜比只在明确选择时才下载，
 * 因为 Chromium 内核的播放器多半解不了它的 E-AC-3 音轨。
 */
export function pickAudioStream(dash: DashPayload | undefined, quality: number): DashStream | null {
  if (!dash) return null
  const regular = (dash.audio ?? []).filter((stream) => streamUrl(stream))
  if ((quality <= 0 || quality === 30250) && streamUrl(dash.flac?.audio)) {
    return dash.flac?.audio ?? null
  }
  if (quality === 30251) {
    const dolby = asList(dash.dolby?.audio).find((stream) => streamUrl(stream))
    if (dolby) return dolby
  }
  // Hi-Res / 杜比的 id 插在普通音质中间，缺失时退到普通音质里的最高档
  if (quality <= 0 || quality === 30250 || quality === 30251) {
    return [...regular].sort((left, right) => right.id - left.id)[0] ?? null
  }
  return pickClosest(regular, quality)
}

/** 只下音频时的扩展名：m4a 装不下 FLAC 和杜比的 E-AC-3，要按音轨来源换容器 */
export function audioOnlyExtension(dash: DashPayload | undefined, stream: DashStream): string {
  if (stream === dash?.flac?.audio) return 'flac'
  if (asList(dash?.dolby?.audio).includes(stream)) return 'mp4'
  return 'm4a'
}

function pickClosest(streams: DashStream[], target: number): DashStream | null {
  if (streams.length === 0) return null
  const sorted = [...streams].sort((left, right) => left.id - right.id)
  const notAbove = sorted.filter((stream) => stream.id <= target)
  return notAbove.length > 0 ? notAbove[notAbove.length - 1] : sorted[0]
}

function asList(value: DashStream[] | DashStream | null | undefined): DashStream[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}
