import { ANALYSIS_DEFAULTS } from '../../../shared/ai'
import type { TranscriptSegment } from '../../../shared/analysis'
import { getSetting, setSetting } from '../../database'
import type { SegmentUnderstanding } from './schema'

/**
 * 统一提示词：用户只维护「分析指令」（关注点 / 标签体系），输出格式由这里固定拼接，
 * 与 schema.ts 的解析逻辑一一对应，换提供方也不用改。
 *
 * 三种形态：
 * - single：短视频 / 图集，一次给全部画面 + 字幕 + 文案，直接出 VideoAnalysis
 * - segment：长视频每段一次，只要「这段讲什么」
 * - reduce：把各段的中间结果与元数据汇总成 VideoAnalysis
 */

/** 输出结构改了就升版本，落库时记下来，方便日后判断哪些结果要重跑 */
export const PROMPT_VERSION = 'v2.1'

export function getAnalysisPrompt(): string {
  return (getSetting('analysis_prompt') || '').trim() || ANALYSIS_DEFAULTS.prompt
}

const PROMPT_MIGRATED_KEY = 'analysis_prompt_v2_migrated'

/**
 * v1 的默认提示词末尾有一段「## 其它字段」，教模型输出 category / scene / summary / content_level 这几个扁平字段。
 * v2 输出格式由程序固定拼接，这段留着会和新格式打架（模型可能回退成旧的扁平 JSON）。
 * 启动时迁移一次：没改过默认的直接换成新默认；改过的只把「其它字段」那一节剪掉，其余保留。
 */
export function migrateAnalysisPromptV2(): void {
  if (getSetting(PROMPT_MIGRATED_KEY) === '1') return
  const current = (getSetting('analysis_prompt') || '').trim()
  if (current) {
    const stripped = stripLegacyFieldsSection(current)
    const untouched =
      normalizePrompt(stripped) === normalizePrompt(stripLegacyFieldsSection(LEGACY_V1_PROMPT))
    const next = untouched ? ANALYSIS_DEFAULTS.prompt : stripped
    if (next !== current) {
      setSetting('analysis_prompt', next)
      console.log(
        `[AI] 分析提示词已迁移到 v2（${untouched ? '替换为新默认' : '移除旧的「其它字段」说明'}）`
      )
    }
  }
  setSetting(PROMPT_MIGRATED_KEY, '1')
}

function normalizePrompt(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 去掉「## 其它字段」这一节（到下一个二级标题或结尾） */
function stripLegacyFieldsSection(text: string): string {
  const match = /^##\s*其它字段[^\n]*\n(?:(?!^##\s)[^\n]*\n?)*/m.exec(text)
  if (!match || !/content_level/.test(match[0])) return text
  return (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim()
}

const LEGACY_V1_PROMPT = `你是短视频内容分析助手，根据视频截帧（或图集图片）判断内容并打标签。

## 标签规则
1. 标签必须原子化：一个标签只表达一个概念，先给基础标签再给组合标签
2. 只输出标签词本身，使用中文，禁止带前缀、禁止包含空格
3. 每条作品 5-15 个标签，优先从下面的参考体系中选，确实没有合适的再新增

## 参考标签体系
【内容类型】舞蹈、唱歌、教程、Vlog、开箱、测评、美食、旅行、运动、游戏、穿搭、美妆、剧情、搞笑、知识分享
【场景】室内、室外、街拍、海边、山景、城市、乡村、咖啡厅、健身房、办公室、家居
【风格】清新、复古、简约、时尚、可爱、酷炫、文艺、治愈、搞怪
【人物】单人、双人、多人、无人
【拍摄】特写、全身、半身、航拍、延时、慢动作

## 其它字段
- category：从【内容类型】里选一个主分类
- scene：从【场景】里选一个
- summary：一句话描述画面内容，15 字以内
- content_level：1-10 的综合质量分（画面质量、创意、制作水平）`

const FULL_OUTPUT_BLOCK = `## 输出格式（必须遵守）
只输出一个 JSON 对象，不要输出任何解释、前后缀或 Markdown 代码块。结构如下（字段名固定，值按实际内容填）：
{
  "content": "视频内容：按时间顺序具体描述这条视频里发生了什么——开头是什么画面、人物做了什么、说了什么（引用口播要点）、画面和场景怎么变化、结尾如何。要像看完后向别人复述一样具体，写成 1-3 个自然段，短视频 150-300 字，长视频 300-600 字",
  "summary": "两三句话概括整条视频讲了什么、怎么呈现（content 的摘要）",
  "category": {"primary": "主分类（从【内容类型】里选）", "secondary": "细分类型或空串"},
  "subjects": {"peopleCount": "单人/双人/多人/无人", "appearance": ["外貌特征"], "outfit": ["穿搭要素"]},
  "setting": {"location": "室内/室外/混合", "place": "具体地点（从【场景】里选或自拟）", "timeOfDay": "白天/夜晚/未知"},
  "actions": ["视频里发生的主要动作或事件"],
  "style": ["从【风格】里选"],
  "onScreenText": ["画面里出现的文字：标题、字幕、贴纸"],
  "speechTopics": ["口播 / 对话涉及的话题；没有口播给空数组"],
  "rating": {"level": 7, "dimensions": {"quality": 7, "appeal": 6}, "reasons": ["评分理由"]},
  "flags": {"isAd": false, "isRepost": false, "hasWatermark": false, "noSpeech": false},
  "tags": [{"name": "标签", "facet": "内容类型/场景/风格/人物/拍摄/其它", "confidence": 0.9}],
  "chapters": [{"start": 0, "end": 30, "title": "章节名", "summary": "这一段讲什么", "tags": ["标签"]}]
}
- content 只写看到、听到的事实，不要评价、不要复述标签；有口播就把说了什么写进去
- tags 至少 8 个，name 只写标签词本身；facet 用上面列出的分面名
- chapters：按镜头 / 内容转折分段，短视频 1-4 段，长视频按转折分，start/end 为秒；单一镜头的短视频可给空数组
- rating.level 与 dimensions 都是 1-10 的整数`

const SEGMENT_OUTPUT_BLOCK = `## 输出格式（必须遵守）
只输出一个 JSON 对象，不要任何解释或 Markdown 代码块：
{
  "content": "这一段的具体内容：按先后顺序描述画面里发生了什么、人物说了什么（引用口播要点）、画面怎么变化，100-250 字，只写看到听到的事实",
  "summary": "这一段讲了什么（一两句话，content 的摘要）",
  "scene": "这一段的地点 / 场景",
  "actions": ["主要动作或事件"],
  "onScreenText": ["画面里出现的文字"],
  "speechTopics": ["这段口播涉及的话题；没有给空数组"],
  "tags": ["这一段适用的标签词"],
  "notable": ["值得注意的点：广告植入、转场、情绪高潮、重要信息等"]
}`

export function buildSinglePrompt(userPrompt: string): string {
  return `${userPrompt.trim()}\n\n${FULL_OUTPUT_BLOCK}`
}

export function buildSegmentPrompt(userPrompt: string): string {
  return `${userPrompt.trim()}

## 当前任务
这是一条长视频中的一段。你只需要理解这一段本身，不要臆测整条视频；整片汇总由后续步骤完成。

${SEGMENT_OUTPUT_BLOCK}`
}

export function buildReducePrompt(userPrompt: string): string {
  return `${userPrompt.trim()}

## 当前任务
下面是一条长视频按时间顺序各段的理解结果（可能只抽样了部分时间段）。请把它们汇总成整条视频的分析：
content 按时间顺序把各段内容串成连贯的全片叙述（保留具体事实和口播要点，不要只是把各段概要拼起来），
summary 概括全片主线，chapters 按内容转折合并相邻相似的段（不必与输入分段一一对应），tags 覆盖全片。

${FULL_OUTPUT_BLOCK}`
}

// ==================== 用户消息 ====================

export interface PostContext {
  desc: string | null
  caption: string | null
  aweme_type: number
  nickname?: string | null
  create_time?: string | null
}

function captionLine(post: PostContext): string {
  const text = (post.desc || post.caption || '').trim().slice(0, 500)
  return text ? `作品文案：「${text}」` : '作品没有文案。'
}

function metaLines(post: PostContext, duration: number | null): string {
  const lines: string[] = []
  if (post.nickname) lines.push(`作者：${post.nickname}`)
  if (duration) lines.push(`视频时长：${formatTime(duration)}`)
  if (post.create_time) lines.push(`发布时间：${post.create_time}`)
  return lines.join('；')
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m >= 60)
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** 字幕按时间戳排版；太长时截头留尾 */
export function formatTranscript(segments: TranscriptSegment[], maxChars = 6000): string {
  if (!segments.length) return ''
  const lines = segments.map((s) => `[${formatTime(s.start)}] ${s.text}`)
  let text = lines.join('\n')
  if (text.length > maxChars) {
    const head = text.slice(0, Math.floor(maxChars * 0.7))
    const tail = text.slice(-Math.floor(maxChars * 0.25))
    text = `${head}\n……（中间省略）……\n${tail}`
  }
  return text
}

function framesLine(times: number[], mosaic: boolean, imageCount: number): string {
  const stamps = times.map(formatTime).join('、')
  if (mosaic) {
    return `附图是这段视频的 ${times.length} 帧画面拼成的一张网格图，从左到右、从上到下依次对应时间点：${stamps}。`
  }
  return `附 ${imageCount} 帧画面，按时间顺序依次截自：${stamps}。`
}

export function buildSingleMessage(input: {
  post: PostContext
  duration: number | null
  times: number[]
  mosaic: boolean
  imageCount: number
  transcript: TranscriptSegment[]
  transcribed: boolean
  silent: boolean
}): string {
  const parts: string[] = []
  if (input.post.aweme_type === 68) {
    parts.push(`这是同一条图文作品的 ${input.imageCount} 张图片。`)
  } else {
    parts.push(framesLine(input.times, input.mosaic, input.imageCount))
  }
  const meta = metaLines(input.post, input.duration)
  if (meta) parts.push(meta)
  parts.push(captionLine(input.post))
  parts.push(transcriptBlock(input.transcript, input.transcribed, input.silent))
  parts.push('请综合画面、语音与文案分析整条作品，按要求输出 JSON。')
  return parts.join('\n')
}

function transcriptBlock(
  transcript: TranscriptSegment[],
  transcribed: boolean,
  silent: boolean
): string {
  if (!transcribed) return '（未做语音转写，请仅依据画面与文案判断。）'
  if (silent) return '语音转写：这段没有声音。'
  if (!transcript.length) return '语音转写：没有识别到人声（可能只有背景音乐）。'
  return `语音转写（自动识别，可能有错字，歌词也会被识别出来）：\n${formatTranscript(transcript)}`
}

export function buildSegmentMessage(input: {
  post: PostContext
  duration: number
  window: { index: number; start: number; end: number }
  totalWindows: number
  times: number[]
  mosaic: boolean
  imageCount: number
  transcript: TranscriptSegment[]
  transcribed: boolean
  silent: boolean
}): string {
  const parts: string[] = []
  parts.push(
    `整条视频时长 ${formatTime(input.duration)}，这是第 ${input.window.index + 1}/${input.totalWindows} 段：${formatTime(input.window.start)} - ${formatTime(input.window.end)}。`
  )
  parts.push(framesLine(input.times, input.mosaic, input.imageCount))
  if (input.window.index === 0) parts.push(captionLine(input.post))
  parts.push(transcriptBlock(input.transcript, input.transcribed, input.silent))
  parts.push('请只分析这一段，按要求输出 JSON。')
  return parts.join('\n')
}

export function buildReduceMessage(input: {
  post: PostContext
  duration: number
  partial: boolean
  segments: SegmentUnderstanding[]
  anySpeech: boolean
}): string {
  const parts: string[] = []
  const meta = metaLines(input.post, input.duration)
  if (meta) parts.push(meta)
  parts.push(captionLine(input.post))
  if (input.partial) {
    parts.push(
      '注意：视频过长，只抽样分析了下面这些时间段，段与段之间有未分析的内容，请在 summary 里据此推断整体，不要编造未看到的细节。'
    )
  }
  if (!input.anySpeech) parts.push('全片没有识别到人声，flags.noSpeech 应为 true。')
  parts.push('## 各段理解结果')
  for (const seg of input.segments) {
    const lines = [
      `### ${formatTime(seg.start)} - ${formatTime(seg.end)}`,
      `概要：${seg.summary || '（空）'}`,
      seg.content ? `内容：${seg.content}` : '',
      seg.scene ? `场景：${seg.scene}` : '',
      seg.actions.length ? `动作/事件：${seg.actions.join('、')}` : '',
      seg.speechTopics.length ? `口播话题：${seg.speechTopics.join('、')}` : '',
      seg.onScreenText.length ? `画面文字：${seg.onScreenText.join(' / ')}` : '',
      seg.tags.length ? `标签：${seg.tags.join('、')}` : '',
      seg.notable.length ? `值得注意：${seg.notable.join('；')}` : ''
    ].filter(Boolean)
    parts.push(lines.join('\n'))
  }
  parts.push('请汇总成整条视频的分析，按要求输出 JSON。chapters 的 start/end 用秒。')
  return parts.join('\n\n')
}
