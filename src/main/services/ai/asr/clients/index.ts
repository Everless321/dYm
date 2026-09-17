import type { AsrClient, ResolvedAsrProvider } from '../types'
import { OpenAiTranscriptionsClient } from './openai-transcriptions'
import { OpenAiChatAudioClient } from './openai-chat-audio'
import { GeminiAudioClient } from './gemini-audio'

export function createAsrClient(provider: ResolvedAsrProvider): AsrClient {
  switch (provider.protocol) {
    case 'openai-transcriptions':
      return new OpenAiTranscriptionsClient(provider)
    case 'openai-chat-audio':
      return new OpenAiChatAudioClient(provider)
    case 'gemini-audio':
      return new GeminiAudioClient(provider)
    default:
      throw new Error(`未知转写协议：${String(provider.protocol)}`)
  }
}

export { OpenAiTranscriptionsClient, OpenAiChatAudioClient, GeminiAudioClient }
