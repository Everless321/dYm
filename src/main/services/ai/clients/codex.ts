import type {
  AiClient,
  AiModelInfo,
  ResolvedProvider,
  VisionRequest,
  VisionResponse
} from '../types'
import { AiHttpError } from '../types'
import { OpenAiResponsesClient } from './openai-responses'
import {
  CODEX_ORIGINATOR,
  ensureFreshCredential,
  parseCodexCredential,
  type CodexCredential
} from '../codex-auth'

export const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'

/** Codex 后端不提供 /models；这是订阅目前常见可用的型号，服务端最终裁决 */
export const CODEX_KNOWN_MODELS: AiModelInfo[] = [
  { id: 'gpt-5.5', label: 'GPT-5.5（多模态，推荐）' },
  { id: 'gpt-5.5-mini', label: 'GPT-5.5 mini' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
  { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
  { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex mini' }
]

/**
 * ChatGPT 订阅（Codex 后端）：Responses 协议 + OAuth 令牌。
 * 令牌快过期时自动刷新并回写；401 时强制刷新重试一次。
 */
export class CodexClient implements AiClient {
  private credential: CodexCredential | null

  constructor(
    private readonly provider: ResolvedProvider,
    private readonly persist: (credentialJson: string) => void
  ) {
    this.credential = parseCodexCredential(provider.credential)
  }

  private async fresh(force = false): Promise<CodexCredential> {
    if (!this.credential) throw new Error('尚未登录 ChatGPT，请在提供方设置里完成登录')
    const cred = force ? { ...this.credential, expires_at: 0 } : this.credential
    this.credential = await ensureFreshCredential(cred, (next) => {
      this.credential = next
      this.persist(JSON.stringify(next))
    })
    return this.credential
  }

  private async inner(): Promise<OpenAiResponsesClient> {
    const cred = await this.fresh()
    return new OpenAiResponsesClient(
      { ...this.provider, baseUrl: CODEX_BASE_URL, credential: cred.access_token },
      {
        codexMode: true,
        headers: () => ({
          'chatgpt-account-id': cred.account_id,
          'OpenAI-Beta': 'responses=experimental',
          originator: CODEX_ORIGINATOR,
          'User-Agent': `${CODEX_ORIGINATOR}/electron`
        })
      }
    )
  }

  async complete(request: VisionRequest): Promise<VisionResponse> {
    try {
      return await (await this.inner()).complete(request)
    } catch (error) {
      if (error instanceof AiHttpError && error.status === 401) {
        await this.fresh(true)
        return (await this.inner()).complete(request)
      }
      throw error
    }
  }

  async verify(): Promise<void> {
    await (await this.inner()).verify()
  }

  async listModels(): Promise<AiModelInfo[] | null> {
    return CODEX_KNOWN_MODELS
  }
}
