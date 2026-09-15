import { getPostById, savePostAnalysis, type DbPost } from '../../database'
import { emitPostAnalyzed } from '../scripts/emit'
import type { AiClient } from './types'
import { AiHttpError } from './types'
import { loadPostImages } from './frames'
import { buildSystemPrompt, buildUserMessage, parseAnalysisOutput } from './prompt'
import type { RateLimiter } from './rate-limit'

export interface AnalyzeOptions {
  client: AiClient
  limiter: RateLimiter
  systemPrompt: string
  slices: number
  tagMode: 'open' | 'closed'
  signal: AbortSignal
  /** 模型名，写入 analysis_model */
  model: string
}

/** 429 / 5xx / 网络抖动重试一次；4xx 请求本身有问题不重试 */
function isRetryable(error: unknown): boolean {
  if (error instanceof AiHttpError) return error.status === 429 || error.status >= 500
  const name = (error as Error)?.name
  return name === 'TimeoutError' || name === 'TypeError'
}

/**
 * 分析单条作品：读图 → 限流 → 调模型 → 解析 → 落库。
 * 抛出的错误即该条失败原因；signal 触发时抛 AbortError 由队列区分暂停/取消。
 */
export async function analyzeOnePost(post: DbPost, options: AnalyzeOptions): Promise<string[]> {
  const images = await loadPostImages(post, options.slices)
  options.signal.throwIfAborted()

  const request = {
    system: options.systemPrompt,
    prompt: buildUserMessage(post, images.length),
    images,
    signal: options.signal,
    json: true
  }

  let response
  for (let attempt = 0; ; attempt++) {
    await options.limiter.wait(options.signal)
    try {
      response = await options.client.complete(request)
      break
    } catch (error) {
      if (options.signal.aborted) throw error
      if (attempt === 0 && isRetryable(error)) {
        console.warn(`[AI] 作品 ${post.aweme_id} 请求失败，重试一次：${(error as Error).message}`)
        continue
      }
      throw error
    }
  }

  const result = parseAnalysisOutput(response.text, response.model ?? options.model)
  options.signal.throwIfAborted()
  const kept = savePostAnalysis(post.id, result, options.tagMode)
  const updated = getPostById(post.id)
  if (updated) emitPostAnalyzed(updated)
  return kept
}

export { buildSystemPrompt }
