// ============ Database Models ============

export interface DbUser {
  id: number
  sec_uid: string
  uid: string
  nickname: string
  signature: string
  avatar: string
  short_id: string
  unique_id: string
  following_count: number
  follower_count: number
  total_favorited: number
  aweme_count: number
  downloaded_count: number
  homepage_url: string
  show_in_home: number
  max_download_count: number
  remark: string
  auto_sync: number
  sync_cron: string
  last_sync_at: number | null
  sync_status: 'idle' | 'syncing' | 'error'
  created_at: number
  updated_at: number
}

export interface DbTask {
  id: number
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  concurrency: number
  total_videos: number
  downloaded_videos: number
  auto_sync: number
  sync_cron: string
  last_sync_at: number | null
  created_at: number
  updated_at: number
}

export interface DbTaskWithUsers extends DbTask {
  users: DbUser[]
}

export interface DbPost {
  id: number
  aweme_id: string
  user_id: number
  sec_uid: string
  nickname: string
  caption: string
  desc: string
  aweme_type: number
  create_time: string
  folder_name: string
  cover_path: string | null
  video_path: string | null
  music_path: string | null
  downloaded_at: number
  analysis_tags: string | null
  analysis_category: string | null
  analysis_summary: string | null
  analysis_scene: string | null
  analysis_content_level: number | null
  analyzed_at: number | null
}

// ============ API Input Types ============

export interface CreateUserInput {
  sec_uid: string
  uid?: string
  nickname?: string
  signature?: string
  avatar?: string
  short_id?: string
  unique_id?: string
  following_count?: number
  follower_count?: number
  total_favorited?: number
  aweme_count?: number
  homepage_url?: string
}

export interface UpdateUserSettingsInput {
  show_in_home?: boolean
  max_download_count?: number
  remark?: string
  auto_sync?: boolean
  sync_cron?: string
}

export interface CreateTaskInput {
  name: string
  user_ids: number[]
  concurrency?: number
  auto_sync?: boolean
  sync_cron?: string
}

export interface UpdateTaskInput {
  name?: string
  status?: string
  concurrency?: number
  auto_sync?: boolean
  sync_cron?: string
}

export interface CreatePostInput {
  aweme_id: string
  user_id: number
  sec_uid: string
  nickname?: string
  caption?: string
  desc?: string
  aweme_type?: number
  create_time?: string
  folder_name: string
  cover_path?: string
  video_path?: string
  music_path?: string
}

export interface PostFilters {
  secUid?: string
  tags?: string[]
  minContentLevel?: number
  maxContentLevel?: number
  analyzedOnly?: boolean
}

// ============ API Response Types ============

export interface PostAuthor {
  sec_uid: string
  nickname: string
}

export interface PostsResponse {
  posts: DbPost[]
  total: number
  authors: PostAuthor[]
}

export interface BatchRefreshResult {
  success: number
  failed: number
  details: string[]
}

export interface AnalysisResult {
  tags: string[]
  category: string
  summary: string
  scene: string
  content_level: number
}

export interface UserAnalysisStats {
  sec_uid: string
  nickname: string
  total: number
  analyzed: number
  unanalyzed: number
}

export interface TotalAnalysisStats {
  total: number
  analyzed: number
  unanalyzed: number
}

export interface MediaFiles {
  type: 'video' | 'images'
  video?: string
  images?: string[]
  cover?: string
  music?: string
}

export interface VideoInfo {
  awemeId: string
  desc: string
  nickname: string
  coverUrl: string
  type: 'video' | 'images'
  videoUrl?: string
  imageUrls?: string[]
}

export interface LinkParseResult {
  type: 'user' | 'video' | 'unknown'
  id: string
}

// ============ WebSocket Event Types ============

export interface SyncProgress {
  userId: number
  status: 'syncing' | 'completed' | 'failed' | 'stopped'
  nickname: string
  currentVideo: number
  totalVideos: number
  downloadedCount: number
  skippedCount: number
  message: string
}

export interface DownloadProgress {
  taskId: number
  status: 'running' | 'completed' | 'failed'
  currentUser: string | null
  currentUserIndex: number
  totalUsers: number
  currentVideo: number
  totalVideos: number
  message: string
  downloadedPosts: number
}

export interface AnalysisProgress {
  status: 'running' | 'completed' | 'failed' | 'stopped'
  currentPost: string | null
  currentIndex: number
  totalPosts: number
  analyzedCount: number
  failedCount: number
  message: string
}

export interface SchedulerLog {
  timestamp: number
  level: 'info' | 'warn' | 'error'
  message: string
  type: 'user' | 'task' | 'system'
  targetName?: string
}

export type WsEvent =
  | { channel: 'sync:progress'; data: SyncProgress }
  | { channel: 'download:progress'; data: DownloadProgress }
  | { channel: 'analysis:progress'; data: AnalysisProgress }
  | { channel: 'scheduler:log'; data: SchedulerLog }

// ============ API Endpoint Types ============

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
