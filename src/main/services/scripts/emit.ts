import { appEvents } from '../app-events'
import type { DbLiveRecord, DbPost, DbUser } from '../../database'
import type { ScriptPostSnapshot } from './types'

function parseJsonArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function toPostSnapshot(post: DbPost): ScriptPostSnapshot {
  return {
    id: post.id,
    awemeId: post.aweme_id,
    userId: post.user_id,
    secUid: post.sec_uid,
    nickname: post.nickname,
    folderName: post.folder_name,
    desc: post.desc,
    awemeType: post.aweme_type,
    tags: parseJsonArray(post.analysis_tags),
    manualTags: parseJsonArray(post.manual_tags),
    category: post.analysis_category,
    summary: post.analysis_summary,
    scene: post.analysis_scene,
    contentLevel: post.analysis_content_level
  }
}

export function emitPostDownloaded(
  post: DbPost,
  folderPath: string,
  source: 'task' | 'sync' | 'single'
): void {
  appEvents.emitHook({
    hook: 'post.downloaded',
    source,
    post: toPostSnapshot(post),
    folderPath
  })
}

export function emitPostAnalyzed(post: DbPost): void {
  appEvents.emitHook({
    hook: 'post.analyzed',
    post: toPostSnapshot(post)
  })
}

export function emitUserAdded(user: DbUser): void {
  appEvents.emitHook({
    hook: 'user.added',
    user: {
      id: user.id,
      secUid: user.sec_uid,
      uid: user.uid,
      nickname: user.nickname,
      uniqueId: user.unique_id
    }
  })
}

export function emitLiveConverted(record: DbLiveRecord): void {
  appEvents.emitHook({
    hook: 'live.converted',
    record: {
      id: record.id,
      userId: record.user_id,
      nickname: record.nickname,
      roomId: record.room_id,
      filePath: record.file_path,
      fileSize: record.file_size
    }
  })
}
