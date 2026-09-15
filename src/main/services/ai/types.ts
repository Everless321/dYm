import type { AiModelInfo, AiProtocol, AiReasoningEffort } from '../../../shared/ai'

/** 主进程内部使用的提供方（含解密后的凭据） */
export interface ResolvedProvider {
  id: string
  name: string
  protocol: AiProtocol
  baseUrl: string
  model: string
  /** API Key；codex 协议下为 JSON 序列化的 OAuth 凭据 */
  credential: string
  reasoningEffort: AiReasoningEffort | null
  /** 网关要求的附加请求头（如 OpenCode 的 User-Agent / x-opencode-session），所有协议客户端都会带上 */
  extraHeaders?: Record<string, string>
}

export interface VisionImage {
  mime: 'image/jpeg' | 'image/png' | 'image/webp'
  data: Buffer
}

export interface VisionRequest {
  /** 系统指令（角色、规则、输出格式） */
  system: string
  /** 用户消息文本 */
  prompt: string
  images: VisionImage[]
  signal?: AbortSignal
  /** 期望模型直接输出 JSON 对象；能用 structured output 的协议会打开 */
  json?: boolean
  maxOutputTokens?: number
}

export interface VisionResponse {
  /** 模型输出的正文 */
  text: string
  model?: string
  usage?: { input?: number; output?: number }
}

export type { AiModelInfo }

export interface AiClient {
  complete(request: VisionRequest): Promise<VisionResponse>
  /** 最小代价的连通性验证；失败抛出带 HTTP 状态与服务端错误信息的 Error */
  verify(): Promise<void>
  /** 拉取模型列表；协议不支持时返回 null */
  listModels(): Promise<AiModelInfo[] | null>
}

/** API 返回非 2xx 时抛出，带状态码方便上层决定是否重试 */
export class AiHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: string
  ) {
    super(message)
    this.name = 'AiHttpError'
  }
}
