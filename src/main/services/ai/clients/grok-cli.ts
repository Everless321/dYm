import type {
  AiClient,
  AiModelInfo,
  ResolvedProvider,
  VisionRequest,
  VisionResponse
} from '../types'
import { AiHttpError } from '../types'
import { OpenAiResponsesClient } from './openai-responses'
import { readGrokCliToken } from '../grok-auth'

export const GROK_CLI_BASE_URL = 'https://cli-chat-proxy.grok.com/v1'

const NOT_LOGGED_IN = '未检测到 Grok CLI 登录，请先在终端运行 grok login'
const EXPIRED = 'Grok 登录已过期，请在终端运行 grok login 后重试'

/**
 * Grok 订阅（SuperGrok）：借用本机 Grok CLI 的会话令牌调用 cli-chat-proxy。
 * 请求头按 Grok CLI README「Using auth.json for API Access」一节的要求补齐。
 */
export class GrokCliClient implements AiClient {
  constructor(private readonly provider: ResolvedProvider) {}

  private inner(): OpenAiResponsesClient {
    const token = readGrokCliToken()
    if (!token) throw new Error(NOT_LOGGED_IN)
    return new OpenAiResponsesClient({
      ...this.provider,
      baseUrl: GROK_CLI_BASE_URL,
      credential: token,
      extraHeaders: {
        ...this.provider.extraHeaders,
        'X-XAI-Token-Auth': 'xai-grok-cli',
        // 代理按这个头而不是 body 里的 model 路由
        'x-grok-model-override': this.provider.model.trim()
      }
    })
  }

  private async run<T>(fn: (client: OpenAiResponsesClient) => Promise<T>): Promise<T> {
    try {
      return await fn(this.inner())
    } catch (error) {
      if (error instanceof AiHttpError && error.status === 401) throw new Error(EXPIRED)
      throw error
    }
  }

  complete(request: VisionRequest): Promise<VisionResponse> {
    return this.run((client) => client.complete(request))
  }

  verify(): Promise<void> {
    return this.run((client) => client.verify())
  }

  listModels(): Promise<AiModelInfo[] | null> {
    return this.run((client) => client.listModels())
  }
}
