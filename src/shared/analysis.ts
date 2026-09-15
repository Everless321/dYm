/**
 * 视频分析结果的结构化形态（schema v2）。主进程解析模型输出后落库，渲染端按此展示。
 * 旧的 posts.analysis_* 扁平列仍由 v2 结果映射回写，老页面不受影响。
 */

export const ANALYSIS_SCHEMA_VERSION = 2

export interface AnalysisTag {
  name: string
  /** 分面：内容类型 / 场景 / 风格 / 人物 / 拍摄 / 其它…… 由模型给出，空串表示未知 */
  facet: string
  /** 0-1 */
  confidence: number
}

export interface AnalysisChapter {
  /** 起止秒 */
  start: number
  end: number
  title: string
  summary: string
  tags: string[]
}

export interface VideoAnalysis {
  schemaVersion: typeof ANALYSIS_SCHEMA_VERSION
  /** 两三句话：这条视频整体在讲什么 */
  summary: string
  category: { primary: string; secondary: string }
  subjects: {
    /** 单人 / 双人 / 多人 / 无人 */
    peopleCount: string
    appearance: string[]
    outfit: string[]
  }
  setting: {
    /** 室内 / 室外 / 混合 */
    location: string
    /** 具体地点：卧室、海边、舞台…… */
    place: string
    timeOfDay: string
  }
  actions: string[]
  style: string[]
  /** 画面里出现的文字（字幕、标题、弹幕等） */
  onScreenText: string[]
  /** 口播 / 对话涉及的话题 */
  speechTopics: string[]
  rating: {
    /** 1-10 综合分 */
    level: number
    dimensions: Record<string, number>
    reasons: string[]
  }
  flags: {
    isAd: boolean
    isRepost: boolean
    hasWatermark: boolean
    /** 没有口播（纯 BGM / 无音轨 / 未转写） */
    noSpeech: boolean
  }
  tags: AnalysisTag[]
  /** 长视频的章节；短视频通常只有一段或为空 */
  chapters: AnalysisChapter[]
}

/** 字幕片段（绝对秒） */
export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface PostTranscript {
  postId: number
  engine: string
  language: string | null
  /** 是否覆盖了全片（超长视频只转写被抽样的段） */
  partial: boolean
  /** 实际转写过的时间范围（绝对秒），重新分析时同引擎可复用 */
  coverage: { start: number; end: number }[]
  segments: TranscriptSegment[]
  text: string
}

/** 一次分析的元信息（落库到 post_analysis） */
export interface AnalysisRunMeta {
  model: string
  asrEngine: string | null
  promptVersion: string
  /** 视频时长（秒）与实际分析覆盖的秒数 */
  duration: number
  analyzedSeconds: number
  segmentCount: number
  frameCount: number
  tokensIn: number
  tokensOut: number
  elapsedMs: number
}

/** 渲染端取单条作品分析详情的返回 */
export interface PostAnalysisDetail {
  analysis: VideoAnalysis | null
  meta: (AnalysisRunMeta & { createdAt: number }) | null
  transcript: PostTranscript | null
}

/** 分析流程阶段（队列进度展示） */
export type AnalysisStage = 'probe' | 'transcribe' | 'frames' | 'segment' | 'reduce' | 'save'

export const ANALYSIS_STAGE_LABELS: Record<AnalysisStage, string> = {
  probe: '读取媒体信息',
  transcribe: '语音转写',
  frames: '抽取画面',
  segment: '分段理解',
  reduce: '汇总',
  save: '写入结果'
}
