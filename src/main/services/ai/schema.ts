import {
  ANALYSIS_SCHEMA_VERSION,
  type AnalysisChapter,
  type AnalysisTag,
  type VideoAnalysis
} from '../../../shared/analysis'
import { extractJsonObject } from './json'

/**
 * 模型输出 → VideoAnalysis 的宽容解析：字段缺了给默认值、类型不对尽量转、越界的裁掉。
 * 宁可少一个字段也不要让整条分析因为模型多写了一个逗号而失败。
 */

export class AnalysisParseError extends Error {
  constructor(
    message: string,
    public readonly raw: string
  ) {
    super(message)
    this.name = 'AnalysisParseError'
  }
}

function str(value: unknown, max = 200): string {
  if (typeof value === 'string') return value.trim().slice(0, max)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function strList(value: unknown, max = 30): string[] {
  let items: unknown[] = []
  if (Array.isArray(value)) items = value
  else if (typeof value === 'string') items = value.split(/[,，、;；\n]/)
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const s = str(item, 60)
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : parseFloat(str(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return /^(true|yes|是|1)$/i.test(value.trim())
  return false
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function tags(value: unknown): AnalysisTag[] {
  if (!Array.isArray(value)) {
    // 兼容 "a, b, c" 或旧格式的字符串数组
    return strList(value).map((name) => ({ name, facet: '', confidence: 0.7 }))
  }
  const out: AnalysisTag[] = []
  const seen = new Set<string>()
  for (const item of value) {
    let tag: AnalysisTag | null = null
    if (typeof item === 'string') {
      const name = str(item, 60)
      if (name) tag = { name, facet: '', confidence: 0.7 }
    } else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>
      const name = str(rec.name ?? rec.tag ?? rec.label, 60)
      if (name) {
        tag = {
          name,
          facet: str(rec.facet ?? rec.type ?? rec.category, 20),
          confidence: num(rec.confidence ?? rec.score, 0, 1, 0.7)
        }
      }
    }
    if (!tag || seen.has(tag.name)) continue
    seen.add(tag.name)
    out.push(tag)
    if (out.length >= 40) break
  }
  return out
}

function chapters(value: unknown, duration: number): AnalysisChapter[] {
  if (!Array.isArray(value)) return []
  const out: AnalysisChapter[] = []
  for (const item of value) {
    const rec = obj(item)
    const start = num(rec.start ?? rec.start_sec ?? rec.from, 0, duration, 0)
    const end = num(rec.end ?? rec.end_sec ?? rec.to, start, duration, duration)
    const title = str(rec.title, 60)
    const summary = str(rec.summary ?? rec.description, 300)
    if (!title && !summary) continue
    out.push({ start, end, title, summary, tags: strList(rec.tags, 10) })
    if (out.length >= 60) break
  }
  return out.sort((a, b) => a.start - b.start)
}

/** 分维度评分：只收 1-10 的数值项 */
function dimensions(value: unknown): Record<string, number> {
  const rec = obj(value)
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(rec)) {
    const key = k.trim().slice(0, 30)
    const n = typeof v === 'number' ? v : parseFloat(str(v))
    if (key && Number.isFinite(n)) out[key] = Math.min(10, Math.max(1, Math.round(n)))
  }
  return out
}

export function toVideoAnalysis(raw: Record<string, unknown>, duration: number): VideoAnalysis {
  const category = obj(raw.category)
  const subjects = obj(raw.subjects)
  const setting = obj(raw.setting)
  const rating = obj(raw.rating)
  const flags = obj(raw.flags)
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    summary: str(raw.summary, 600),
    category: {
      // 兼容旧格式：category 直接是字符串
      primary: str(category.primary ?? (typeof raw.category === 'string' ? raw.category : ''), 30),
      secondary: str(category.secondary, 30)
    },
    subjects: {
      peopleCount: str(subjects.peopleCount ?? subjects.people_count ?? subjects.people, 10),
      appearance: strList(subjects.appearance, 10),
      outfit: strList(subjects.outfit, 10)
    },
    setting: {
      location: str(setting.location, 20),
      place: str(setting.place ?? (typeof raw.scene === 'string' ? raw.scene : ''), 30),
      timeOfDay: str(setting.timeOfDay ?? setting.time_of_day, 10)
    },
    actions: strList(raw.actions, 15),
    style: strList(raw.style, 10),
    onScreenText: strList(raw.onScreenText ?? raw.on_screen_text, 20),
    speechTopics: strList(raw.speechTopics ?? raw.speech_topics, 15),
    rating: {
      level: Math.round(num(rating.level ?? raw.content_level, 1, 10, 5)),
      dimensions: dimensions(rating.dimensions),
      reasons: strList(rating.reasons, 5)
    },
    flags: {
      isAd: bool(flags.isAd ?? flags.is_ad),
      isRepost: bool(flags.isRepost ?? flags.is_repost),
      hasWatermark: bool(flags.hasWatermark ?? flags.has_watermark),
      noSpeech: bool(flags.noSpeech ?? flags.no_speech)
    },
    tags: tags(raw.tags),
    chapters: chapters(raw.chapters, duration)
  }
}

export function parseVideoAnalysis(text: string, duration: number): VideoAnalysis {
  if (!text.trim()) throw new AnalysisParseError('模型没有返回内容', text)
  const raw = extractJsonObject(text)
  if (!raw) throw new AnalysisParseError('模型输出里找不到 JSON 对象', text)
  const analysis = toVideoAnalysis(raw, duration)
  if (!analysis.tags.length) throw new AnalysisParseError('模型输出的 tags 为空', text)
  return analysis
}

/** 分段理解的中间结果（比整片结构简单：只要这段讲什么、有什么） */
export interface SegmentUnderstanding {
  start: number
  end: number
  summary: string
  scene: string
  actions: string[]
  onScreenText: string[]
  speechTopics: string[]
  tags: string[]
  notable: string[]
}

export function parseSegmentUnderstanding(
  text: string,
  window: { start: number; end: number }
): SegmentUnderstanding {
  if (!text.trim()) throw new AnalysisParseError('模型没有返回内容', text)
  const raw = extractJsonObject(text)
  if (!raw) throw new AnalysisParseError('模型输出里找不到 JSON 对象', text)
  return {
    start: window.start,
    end: window.end,
    summary: str(raw.summary, 400),
    scene: str(raw.scene, 40),
    actions: strList(raw.actions, 10),
    onScreenText: strList(raw.onScreenText ?? raw.on_screen_text, 15),
    speechTopics: strList(raw.speechTopics ?? raw.speech_topics, 10),
    tags: strList(raw.tags, 15),
    notable: strList(raw.notable, 5)
  }
}
