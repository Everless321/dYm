import { getDatabase } from './connection'
import { replacePostTags } from './tags'
import type {
  AnalysisRunMeta,
  PostAnalysisDetail,
  PostTranscript,
  VideoAnalysis
} from '../../shared/analysis'

/**
 * 结构化分析结果（schema v2）的读写。
 * 写入时同步映射回 posts.analysis_* 扁平列，老的列表 / 筛选 / 脚本 API 不用改就能继续用。
 */

interface AnalysisRow {
  post_id: number
  schema_version: number
  prompt_version: string
  model: string | null
  asr_engine: string | null
  result: string
  meta: string
  created_at: number
}

interface TranscriptRow {
  post_id: number
  engine: string
  language: string | null
  partial: number
  coverage: string
  segments: string
  text: string
}

/** v2 结果映射到旧扁平字段：标签名、主分类、地点、摘要、评分 */
export function legacyFieldsOf(analysis: VideoAnalysis): {
  tags: string[]
  category: string
  scene: string
  summary: string
  content_level: number
} {
  return {
    tags: analysis.tags.map((t) => t.name),
    category: analysis.category.primary,
    scene: analysis.setting.place || analysis.setting.location,
    summary: analysis.summary,
    content_level: analysis.rating.level
  }
}

export function savePostAnalysisV2(
  postId: number,
  analysis: VideoAnalysis,
  meta: AnalysisRunMeta,
  options: { tagMode: 'open' | 'closed'; raw?: string | null }
): string[] {
  const database = getDatabase()
  return database.transaction(() => {
    const details = new Map<string, { facet: string; confidence: number }>()
    for (const tag of analysis.tags) {
      details.set(tag.name, { facet: tag.facet, confidence: tag.confidence })
    }
    const kept = replacePostTags(
      postId,
      'ai',
      analysis.tags.map((t) => t.name),
      options.tagMode,
      details
    )
    // closed 模式下没匹配上的标签不算失败：整片摘要、评分等仍然有价值，照常落库
    const legacy = legacyFieldsOf(analysis)
    database
      .prepare(
        `UPDATE posts SET
           analysis_category = ?, analysis_summary = ?, analysis_scene = ?, analysis_content_level = ?,
           analysis_raw = ?, analysis_model = ?, analyzed_at = strftime('%s', 'now')
         WHERE id = ?`
      )
      .run(
        legacy.category,
        legacy.summary,
        legacy.scene,
        legacy.content_level,
        options.raw ?? null,
        meta.model,
        postId
      )
    database
      .prepare(
        `INSERT INTO post_analysis (post_id, schema_version, prompt_version, model, asr_engine, result, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
         ON CONFLICT(post_id) DO UPDATE SET
           schema_version = excluded.schema_version, prompt_version = excluded.prompt_version,
           model = excluded.model, asr_engine = excluded.asr_engine, result = excluded.result,
           meta = excluded.meta, created_at = excluded.created_at`
      )
      .run(
        postId,
        analysis.schemaVersion,
        meta.promptVersion,
        meta.model,
        meta.asrEngine,
        JSON.stringify(analysis),
        JSON.stringify(meta)
      )
    database.prepare('DELETE FROM post_chapters WHERE post_id = ?').run(postId)
    const insertChapter = database.prepare(
      `INSERT INTO post_chapters (post_id, start_sec, end_sec, title, summary, tags) VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const chapter of analysis.chapters) {
      insertChapter.run(
        postId,
        chapter.start,
        chapter.end,
        chapter.title,
        chapter.summary,
        JSON.stringify(chapter.tags)
      )
    }
    return kept
  })()
}

export function savePostTranscript(transcript: PostTranscript): void {
  getDatabase()
    .prepare(
      `INSERT INTO post_transcripts (post_id, engine, language, partial, coverage, segments, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
       ON CONFLICT(post_id) DO UPDATE SET
         engine = excluded.engine, language = excluded.language, partial = excluded.partial,
         coverage = excluded.coverage, segments = excluded.segments, text = excluded.text,
         created_at = excluded.created_at`
    )
    .run(
      transcript.postId,
      transcript.engine,
      transcript.language,
      transcript.partial ? 1 : 0,
      JSON.stringify(transcript.coverage),
      JSON.stringify(transcript.segments),
      transcript.text
    )
}

export function getPostTranscript(postId: number): PostTranscript | null {
  const row = getDatabase()
    .prepare('SELECT * FROM post_transcripts WHERE post_id = ?')
    .get(postId) as TranscriptRow | undefined
  if (!row) return null
  return {
    postId: row.post_id,
    engine: row.engine,
    language: row.language,
    partial: row.partial === 1,
    coverage: safeParse(row.coverage, []),
    segments: safeParse(row.segments, []),
    text: row.text
  }
}

export function getPostAnalysisDetail(postId: number): PostAnalysisDetail {
  const row = getDatabase().prepare('SELECT * FROM post_analysis WHERE post_id = ?').get(postId) as
    | AnalysisRow
    | undefined
  const analysis = row ? safeParse<VideoAnalysis | null>(row.result, null) : null
  const meta = row
    ? { ...safeParse<AnalysisRunMeta>(row.meta, {} as AnalysisRunMeta), createdAt: row.created_at }
    : null
  return { analysis, meta, transcript: getPostTranscript(postId) }
}

/** 更新媒体元数据列（探测一次就够，下次分析直接复用） */
export function savePostMediaInfo(
  postId: number,
  info: { duration: number; width: number; height: number; hasAudio: boolean }
): void {
  getDatabase()
    .prepare('UPDATE posts SET duration = ?, width = ?, height = ?, has_audio = ? WHERE id = ?')
    .run(info.duration, info.width, info.height, info.hasAudio ? 1 : 0, postId)
}

/** 字幕全文检索：返回命中的作品 id 与片段高亮 */
export function searchTranscripts(
  keyword: string,
  limit = 50
): { postId: number; snippet: string }[] {
  const q = keyword.trim()
  if (!q) return []
  const database = getDatabase()
  // trigram 分词要求查询词至少 3 个字符，更短的直接 LIKE
  if ([...q].length < 3) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
    return database
      .prepare(
        `SELECT post_id AS postId, substr(text, max(1, instr(text, ?) - 12), 40) AS snippet
         FROM post_transcripts WHERE text LIKE ? ESCAPE '\\' LIMIT ?`
      )
      .all(q, like, limit) as { postId: number; snippet: string }[]
  }
  // 用短语查询避免用户输入里的 fts 语法字符（* " -）被当成操作符
  const phrase = `"${q.replace(/"/g, '""')}"`
  try {
    return (
      database
        .prepare(
          `SELECT rowid AS postId, snippet(post_transcripts_fts, 0, '[', ']', '…', 12) AS snippet
           FROM post_transcripts_fts WHERE post_transcripts_fts MATCH ? ORDER BY rank LIMIT ?`
        )
        .all(phrase, limit) as { postId: number; snippet: string }[]
    ).map((r) => ({ postId: r.postId, snippet: r.snippet }))
  } catch (error) {
    console.warn('[AI] 字幕检索失败:', (error as Error).message)
    return []
  }
}

function safeParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}
