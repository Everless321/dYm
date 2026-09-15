import type { AsrProtocol } from '../../../../shared/ai'
import type { TranscriptSegment } from '../../../../shared/analysis'

/** 主进程内部使用的转写提供方（含解密凭据） */
export interface ResolvedAsrProvider {
  id: string
  name: string
  protocol: AsrProtocol
  baseUrl: string
  model: string
  credential: string
  maxClipSeconds: number
  extraForm: Record<string, string>
}

export type AudioMime = 'audio/mpeg' | 'audio/wav'

export interface AsrRequest {
  audio: Buffer
  mime: AudioMime
  filename: string
  /** 片段时长（秒），Gemini 提示里用 */
  durationSec: number
  /** 语言提示（ISO 639-1），不传让服务自动识别 */
  language?: string
  signal?: AbortSignal
}

export interface AsrResult {
  text: string
  /** 片段内相对秒；接口不给时间戳时为空，调用方用片段边界兜底 */
  segments: TranscriptSegment[]
  language: string | null
}

export interface AsrClient {
  transcribe(request: AsrRequest): Promise<AsrResult>
  /** 用一小段合成音频做最小代价的连通性验证 */
  verify(): Promise<void>
}
