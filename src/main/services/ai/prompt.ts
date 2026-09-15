import { ANALYSIS_DEFAULTS } from '../../../shared/ai'
import { getSetting } from '../../database'
import type { AnalysisResult } from '../../database'
import { extractJsonObject } from './json'

/**
 * 统一提示词：用户只维护「分析指令」（关注点 / 标签体系），输出格式由这里固定拼接，
 * 与 parseAnalysisOutput 的解析逻辑一一对应，换提供方也不用改。
 */
const OUTPUT_FORMAT_BLOCK = `## 输出格式（必须遵守）
只输出一个 JSON 对象，不要输出任何解释、前后缀或 Markdown 代码块：
{"tags":["标签1","标签2"],"category":"主分类","summary":"一句话描述","scene":"场景","content_level":5}
- tags：字符串数组，每个元素是一个标签词
- category / scene / summary：字符串
- content_level：1-10 的整数`

export function getAnalysisPrompt(): string {
  return (getSetting('analysis_prompt') || '').trim() || ANALYSIS_DEFAULTS.prompt
}

export function buildSystemPrompt(userPrompt: string): string {
  return `${userPrompt.trim()}\n\n${OUTPUT_FORMAT_BLOCK}`
}

export function buildUserMessage(
  post: {
    desc: string | null
    caption: string | null
    aweme_type: number
  },
  imageCount: number
): string {
  const text = (post.desc || post.caption || '').trim().slice(0, 300)
  const kind =
    post.aweme_type === 68
      ? `这是同一条图文作品的 ${imageCount} 张图片`
      : `这是同一条视频按时间顺序截取的 ${imageCount} 帧画面`
  const captionLine = text ? `作品文案：「${text}」` : '作品没有文案。'
  return `${kind}。${captionLine}\n请分析后按要求输出 JSON。`
}

export class AnalysisParseError extends Error {
  constructor(
    message: string,
    public readonly raw: string
  ) {
    super(message)
    this.name = 'AnalysisParseError'
  }
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

function asTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => asString(v)).filter(Boolean)
  }
  if (typeof value === 'string') {
    // 个别模型会把数组写成 "a, b, c"
    return value
      .split(/[,，、;；\n]/)
      .map((v) => v.trim())
      .filter(Boolean)
  }
  return []
}

function asLevel(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(asString(value))
  if (!Number.isFinite(n)) return 0
  return Math.max(1, Math.min(10, Math.round(n)))
}

/** 把模型正文解析成结构化结果；raw 原样保留供事后重解析 */
export function parseAnalysisOutput(text: string, model?: string): AnalysisResult {
  if (!text.trim()) throw new AnalysisParseError('模型没有返回内容', text)
  const obj = extractJsonObject(text)
  if (!obj) throw new AnalysisParseError('模型输出里找不到 JSON 对象', text)
  const tags = asTags(obj.tags)
  if (!tags.length) throw new AnalysisParseError('模型输出的 tags 为空', text)
  return {
    tags,
    category: asString(obj.category),
    summary: asString(obj.summary).slice(0, 200),
    scene: asString(obj.scene),
    content_level: asLevel(obj.content_level),
    raw: JSON.stringify(obj),
    model
  }
}
