import { BILIBILI_CODEC_ID, type BilibiliVideoCodec } from '../../../shared/platforms'

export interface DashStream {
  id: number
  codecid?: number
  baseUrl?: string
  base_url?: string
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

/** 优先同一编码里不超过目标画质的最高档；没有该编码时退回任意编码。 */
export function pickVideoStream(
  streams: DashStream[] | undefined,
  quality: number,
  codec: BilibiliVideoCodec
): DashStream | null {
  const usable = (streams ?? []).filter((stream) => streamUrl(stream))
  const sameCodec = usable.filter((stream) => stream.codecid === BILIBILI_CODEC_ID[codec])
  return pickClosest(sameCodec.length > 0 ? sameCodec : usable, quality)
}

/** Hi-Res / 杜比优先走 flac、dolby 节点，缺失时退回普通音轨。 */
export function pickAudioStream(dash: DashPayload | undefined, quality: number): DashStream | null {
  if (!dash) return null
  const regular = (dash.audio ?? []).filter((stream) => streamUrl(stream))
  if (quality === 30250 && streamUrl(dash.flac?.audio)) return dash.flac?.audio ?? null
  if (quality === 30251) {
    const dolby = asList(dash.dolby?.audio).find((stream) => streamUrl(stream))
    if (dolby) return dolby
  }
  // Hi-Res / 杜比的 id 插在普通音质中间，缺失时退到普通音质里的最高档
  if (quality === 30250 || quality === 30251) {
    return [...regular].sort((left, right) => right.id - left.id)[0] ?? null
  }
  return pickClosest(regular, quality)
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
