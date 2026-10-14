import type {
  AiClient,
  AiModelInfo,
  ResolvedProvider,
  VisionRequest,
  VisionResponse
} from '../types'
import { AiHttpError } from '../types'
import { OpenAiResponsesClient } from './openai-responses'
import { ensureFreshGrokCredential, parseGrokCredential, type GrokCredential } from '../grok-auth'

/** 订阅额度走的是 Grok CLI 的推理代理，不是按量计费的 api.x.ai */
export const GROK_BASE_URL = 'https://cli-chat-proxy.grok.com/v1'
/** 代理按这个版本号拦截过旧客户端（HTTP 426）；跟着 https://x.ai/cli/stable 更新 */
const GROK_CLIENT_VERSION = '1.0.52'

/**
 * Grok 订阅（SuperGrok / X Premium）：Responses 协议 + xAI OAuth 令牌。
 * 令牌快过期时自动刷新并回写；401 时强制刷新重试一次。
 */
export class GrokClient implements AiClient {
  private credential: GrokCredential | null

  constructor(
    private readonly provider: ResolvedProvider,
    private readonly persist: (credentialJson: string) => void
  ) {
    this.credential = parseGrokCredential(provider.credential)
  }

  private async fresh(force = false): Promise<GrokCredential> {
    if (!this.credential) throw new Error('尚未登录 Grok，请在提供方设置里完成登录')
    const cred = force ? { ...this.credential, expires_at: 0 } : this.credential
    this.credential = await ensureFreshGrokCredential(cred, (next) => {
      this.credential = next
      this.persist(JSON.stringify(next))
    })
    return this.credential
  }

  private async inner(): Promise<OpenAiResponsesClient> {
    const cred = await this.fresh()
    return new OpenAiResponsesClient({
      ...this.provider,
      baseUrl: GROK_BASE_URL,
      credential: cred.access_token,
      extraHeaders: {
        ...this.provider.extraHeaders,
        'x-xai-token-auth': 'xai-grok-cli',
        'x-grok-client-version': GROK_CLIENT_VERSION,
        // 代理按这个头而不是 body 里的 model 路由
        'x-grok-model-override': this.provider.model.trim()
      }
    })
  }

  private async run<T>(fn: (client: OpenAiResponsesClient) => Promise<T>): Promise<T> {
    try {
      try {
        return await fn(await this.inner())
      } catch (error) {
        if (!(error instanceof AiHttpError) || error.status !== 401) throw error
        await this.fresh(true)
        return await fn(await this.inner())
      }
    } catch (error) {
      if (error instanceof AiHttpError && error.status === 402) {
        throw new Error('Grok 订阅额度已用完，请等额度重置后再试')
      }
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
