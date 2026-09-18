/**
 * AI 分析相关的共享类型与默认值。主进程、preload、渲染端共用一份，
 * 避免同一个默认值在五个文件里各写一遍然后彼此不一致。
 */

/** 推理协议：决定请求怎么拼、响应怎么解析 */
export type AiProtocol =
  | 'openai-chat' // OpenAI 兼容 /chat/completions（Grok、DeepSeek、Ollama、LM Studio、OpenCode Zen 大部分模型）
  | 'openai-responses' // OpenAI /responses（OpenCode Zen 的 GPT 系列、OpenAI 官方）
  | 'anthropic' // Anthropic Messages API（Claude 官方、OpenCode Zen 的 Claude）
  | 'gemini' // Google Gemini generateContent
  | 'codex' // ChatGPT Plus/Pro 订阅（Codex 后端，OAuth 登录，Responses 协议）
  | 'opencode' // OpenCode Zen / Go 订阅：一个 Key，按模型自动走 responses / messages / gemini / chat

export const AI_PROTOCOLS: { value: AiProtocol; label: string; description: string }[] = [
  {
    value: 'openai-chat',
    label: 'OpenAI 兼容（Chat Completions）',
    description: 'Grok、DeepSeek、Ollama、LM Studio、OpenCode Zen 的大部分模型'
  },
  {
    value: 'openai-responses',
    label: 'OpenAI Responses',
    description: 'OpenAI 官方与 OpenCode Zen 的 GPT 系列模型'
  },
  {
    value: 'anthropic',
    label: 'Anthropic Messages',
    description: 'Claude 官方或 OpenCode Zen 的 Claude'
  },
  { value: 'gemini', label: 'Google Gemini', description: 'Gemini 官方 generateContent 接口' },
  {
    value: 'opencode',
    label: 'OpenCode（Zen / Go 订阅）',
    description: '一个 API Key 用全部模型；GPT / Claude / Gemini / 其它按模型自动选择接口'
  },
  {
    value: 'codex',
    label: 'ChatGPT 订阅（Codex）',
    description: '用 ChatGPT Plus / Pro 订阅登录，无需 API Key；走 Codex 后端'
  }
]

/** 常用服务的预设：选中后自动填协议与地址，用户只需填 Key 和模型 */
export interface AiProviderTemplate {
  id: string
  name: string
  protocol: AiProtocol
  baseUrl: string
  model: string
  /** 备注：告诉用户去哪里拿 Key */
  hint?: string
}

export const AI_PROVIDER_TEMPLATES: AiProviderTemplate[] = [
  {
    id: 'grok',
    name: 'xAI Grok',
    protocol: 'openai-chat',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4-fast',
    hint: 'console.x.ai 创建 API Key'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.5-mini',
    hint: 'platform.openai.com 创建 API Key'
  },
  {
    id: 'codex',
    name: 'ChatGPT 订阅（Codex）',
    protocol: 'codex',
    baseUrl: 'https://chatgpt.com/backend-api/codex',
    model: 'gpt-5.5',
    hint: '点「登录 ChatGPT」完成授权，或从本机 Codex CLI 导入登录态'
  },
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen',
    protocol: 'opencode',
    baseUrl: 'https://opencode.ai/zen/v1',
    model: 'gpt-5.6-luna',
    hint: 'opencode.ai/auth 复制 API Key，或从本机 OpenCode CLI 导入；点「获取列表」查看全部模型'
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go（订阅）',
    protocol: 'opencode',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    model: 'gpt-5.6-luna',
    hint: 'Go 是 $10/月 的包月订阅（仅开源模型），Key 同样在 opencode.ai/auth 获取；官方定位是编码 Agent 流量，批量打标签建议优先用 Zen'
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    hint: 'console.anthropic.com 创建 API Key'
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
    hint: 'aistudio.google.com 创建 API Key'
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    protocol: 'openai-chat',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5vl',
    hint: '本地服务无需 Key，模型需支持图片输入'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio（本地）',
    protocol: 'openai-chat',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    hint: '本地服务无需 Key，模型需支持图片输入'
  }
]

/** 推理深度（仅 Responses / Codex 协议的推理模型有效） */
export type AiReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high'

/** 提供方（渲染端可见的形态：不含密钥明文，只告诉有没有配） */
export interface AiProviderView {
  id: string
  name: string
  protocol: AiProtocol
  baseUrl: string
  model: string
  hasCredential: boolean
  /** Codex：登录账号邮箱等展示信息 */
  credentialLabel: string | null
  reasoningEffort: AiReasoningEffort | null
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

/** 保存提供方时的入参；apiKey 为 undefined 表示不改动已存的密钥 */
export interface AiProviderInput {
  id?: string
  name: string
  protocol: AiProtocol
  baseUrl: string
  model: string
  apiKey?: string
  reasoningEffort?: AiReasoningEffort | null
}

export interface AiModelInfo {
  id: string
  label?: string
}

/** 本机 OpenCode CLI（~/.local/share/opencode/auth.json）里可导入的 Key */
export interface OpenCodeCliKey {
  /** models.dev 提供方 id：opencode（Zen）或 opencode-go */
  entry: 'opencode' | 'opencode-go'
  key: string
}

/** Codex 登录状态 */
export interface CodexAuthStatus {
  loggedIn: boolean
  email: string | null
  accountId: string | null
  /** access token 过期时间（秒级时间戳） */
  expiresAt: number | null
  /** 本机 Codex CLI 是否有可导入的登录态 */
  cliAuthAvailable: boolean
}

// ==================== 语音转写（ASR）提供方 ====================

/**
 * 转写协议：
 * - openai-transcriptions：multipart 上传到 /audio/transcriptions（OpenAI、Groq、Mistral、硅基流动、智谱、阶跃）
 * - openai-chat-audio：/chat/completions 里塞 input_audio（阿里百炼 qwen3-asr-flash、OpenAI 音频对话模型）
 * - gemini-audio：Gemini generateContent 内联音频
 */
export type AsrProtocol = 'openai-transcriptions' | 'openai-chat-audio' | 'gemini-audio'

export const ASR_PROTOCOLS: { value: AsrProtocol; label: string; description: string }[] = [
  {
    value: 'openai-transcriptions',
    label: 'OpenAI 兼容（/audio/transcriptions）',
    description: 'OpenAI、Groq、Mistral、硅基流动、智谱、阶跃星辰等，上传音频文件返回文本'
  },
  {
    value: 'openai-chat-audio',
    label: 'OpenAI 兼容（Chat 内联音频）',
    description: '阿里百炼 Qwen3-ASR 等：音频以 base64 放进 chat/completions 消息'
  },
  {
    value: 'gemini-audio',
    label: 'Google Gemini（音频理解）',
    description: 'Gemini generateContent 内联音频，顺带要求按时间段输出'
  }
]

export interface AsrProviderTemplate {
  id: string
  name: string
  protocol: AsrProtocol
  baseUrl: string
  model: string
  /** 单次请求最长音频秒数（接口限制），超过按此切片后拼接 */
  maxClipSeconds: number
  /** multipart 额外字段（如 response_format=verbose_json 取时间戳） */
  extraForm?: Record<string, string>
  /** 国内 / 海外，设置页分组展示 */
  region: 'cn' | 'global'
  hint?: string
}

export const ASR_PROVIDER_TEMPLATES: AsrProviderTemplate[] = [
  // ---- 国内 ----
  {
    id: 'siliconflow',
    name: '硅基流动 SenseVoice',
    protocol: 'openai-transcriptions',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
    maxClipSeconds: 600,
    region: 'cn',
    hint: 'cloud.siliconflow.cn 创建 API Key；中文效果好、便宜，另有 TeleAI/TeleSpeechASR 可选'
  },
  {
    id: 'dashscope',
    name: '阿里百炼 Qwen3-ASR',
    protocol: 'openai-chat-audio',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-asr-flash',
    maxClipSeconds: 240,
    region: 'cn',
    hint: 'bailian.console.aliyun.com 创建 API Key；单段音频 ≤5 分钟、10MB，程序自动切片'
  },
  {
    id: 'zhipu',
    name: '智谱 GLM-ASR',
    protocol: 'openai-transcriptions',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-asr-2512',
    maxClipSeconds: 30,
    region: 'cn',
    hint: 'open.bigmodel.cn 创建 API Key；接口限单段 30 秒，长视频会切成很多片，请求数较多'
  },
  {
    id: 'stepfun',
    name: '阶跃星辰 StepAudio ASR',
    protocol: 'openai-transcriptions',
    baseUrl: 'https://api.stepfun.com/v1',
    model: 'stepaudio-2.5-asr',
    maxClipSeconds: 600,
    extraForm: { response_format: 'json' },
    region: 'cn',
    hint: 'platform.stepfun.com 创建 API Key'
  },
  // ---- 海外 ----
  {
    id: 'openai',
    name: 'OpenAI Transcribe',
    protocol: 'openai-transcriptions',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini-transcribe',
    maxClipSeconds: 600,
    region: 'global',
    hint: 'platform.openai.com 创建 API Key；gpt-transcribe 更准，whisper-1 带分句时间戳'
  },
  {
    id: 'groq',
    name: 'Groq Whisper',
    protocol: 'openai-transcriptions',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3-turbo',
    maxClipSeconds: 600,
    extraForm: { response_format: 'verbose_json', 'timestamp_granularities[]': 'segment' },
    region: 'global',
    hint: 'console.groq.com 创建 API Key；速度快、价格低，带分句时间戳'
  },
  {
    id: 'mistral',
    name: 'Mistral Voxtral',
    protocol: 'openai-transcriptions',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'voxtral-mini-latest',
    maxClipSeconds: 600,
    extraForm: { 'timestamp_granularities[]': 'segment' },
    region: 'global',
    hint: 'console.mistral.ai 创建 API Key'
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    protocol: 'gemini-audio',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
    maxClipSeconds: 600,
    region: 'global',
    hint: 'aistudio.google.com 创建 API Key；与分析用的 Gemini Key 可以是同一个'
  }
]

export interface AsrProviderView {
  id: string
  name: string
  protocol: AsrProtocol
  baseUrl: string
  model: string
  maxClipSeconds: number
  extraForm: Record<string, string>
  hasCredential: boolean
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

/** 保存转写提供方；apiKey 为 undefined 表示不改动已存的密钥 */
export interface AsrProviderInput {
  id?: string
  name: string
  protocol: AsrProtocol
  baseUrl: string
  model: string
  maxClipSeconds?: number
  extraForm?: Record<string, string>
  apiKey?: string
}

// ==================== 分析设置 ====================

/** 标签模式：open=模型输出什么就收什么（经归一化）；closed=只保留标签库里已有（含别名）的标签 */
export type AiTagMode = 'open' | 'closed'

/** 长视频拼图：auto=10 分钟以上启用；on=多段视频都拼；off=永不拼 */
export type AnalysisMosaicMode = 'auto' | 'on' | 'off'

export interface AnalysisSettings {
  /** 用户可编辑的「分析指令」：关注什么、标签体系是什么。输出格式由程序固定拼接，用户不必再写 JSON 说明 */
  prompt: string
  /** 短视频（≤60 秒、单段）最多送几帧；场景检测去重后实际通常更少 */
  framesShort: number
  /** 长视频每段最多送几帧 */
  framesPerSegment: number
  /** 长视频分段长度（秒） */
  segmentSeconds: number
  /** 最多分析多少分钟：超长视频在全片范围内均匀取这么多分钟的段 */
  maxMinutes: number
  /** 超过这个时长（分钟）的视频直接跳过不分析 */
  skipOverMinutes: number
  mosaic: AnalysisMosaicMode
  /** 是否做语音转写（需要配置转写提供方；未配置时自动跳过） */
  transcribe: boolean
  /** 转写每分钟请求上限（按转写提供方独立限流） */
  asrRpm: number
  /** 同时分析的作品数 */
  concurrency: number
  /** 每分钟请求上限 */
  rpm: number
  tagMode: AiTagMode
  /** 下载完成后自动加入分析队列 */
  autoAnalyze: boolean
}

export const ANALYSIS_DEFAULTS: AnalysisSettings = {
  prompt: `你是短视频内容分析助手，结合画面截帧、语音转写和作品文案，理解整条视频在讲什么，并给出结构化标签。

## 标签规则
1. 标签必须原子化：一个标签只表达一个概念，先给基础标签再给组合标签
2. 只输出标签词本身，使用中文，禁止带前缀、禁止包含空格
3. 每条作品 8-20 个标签，优先从下面的参考体系中选，确实没有合适的再新增

## 参考标签体系
【内容类型】舞蹈、唱歌、教程、Vlog、开箱、测评、美食、旅行、运动、游戏、穿搭、美妆、剧情、搞笑、知识分享、访谈、直播切片
【场景】室内、室外、街拍、海边、山景、城市、乡村、咖啡厅、健身房、办公室、家居、舞台
【风格】清新、复古、简约、时尚、可爱、酷炫、文艺、治愈、搞怪、性感
【人物】单人、双人、多人、无人
【拍摄】特写、全身、半身、航拍、延时、慢动作、手持、固定机位

## 评分口径
- rating.level：1-10 的综合质量分（画面质量、创意、制作水平）
- rating.dimensions 里至少给 quality（制作水平）、appeal（吸引力）两项，1-10`,
  framesShort: 16,
  framesPerSegment: 8,
  segmentSeconds: 90,
  maxMinutes: 30,
  skipOverMinutes: 180,
  mosaic: 'auto',
  transcribe: true,
  asrRpm: 30,
  concurrency: 2,
  rpm: 10,
  tagMode: 'open',
  autoAnalyze: false
}

// ==================== 分析队列 ====================

export type AnalysisJobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type AnalysisJobItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export type AnalysisJobKind = 'analyze' | 'reanalyze' | 'auto'

export interface AnalysisJobView {
  id: number
  name: string
  kind: AnalysisJobKind
  status: AnalysisJobStatus
  providerId: string | null
  providerName: string | null
  total: number
  done: number
  failed: number
  skipped: number
  /** 当前正在处理的作品标题（最多几个） */
  current: string[]
  error: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
}

export interface AnalysisJobItemView {
  jobId: number
  postId: number
  title: string
  secUid: string
  nickname: string
  status: AnalysisJobItemStatus
  error: string | null
  attempts: number
  finishedAt: number | null
}

export interface CreateAnalysisJobInput {
  kind?: AnalysisJobKind
  name?: string
  /** 指定作品；不传则按 secUid / onlyUnanalyzed 圈选 */
  postIds?: number[]
  secUid?: string
  /** 默认 true：只分析未分析过的 */
  onlyUnanalyzed?: boolean
  /** 不传用默认提供方 */
  providerId?: string
  /** 转写提供方；不传用默认，设置里关了转写则忽略 */
  asrProviderId?: string
  /** 插队到最前 */
  priority?: boolean
}

/** 队列事件：作业列表快照（节流后推送） */
export interface AnalysisQueueEvent {
  jobs: AnalysisJobView[]
  /** 本次事件里刚完成的条目（供对话框逐条更新） */
  itemDone?: { jobId: number; postId: number; ok: boolean; title: string; error: string | null }
}
