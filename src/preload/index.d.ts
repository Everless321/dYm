import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface DatabaseAPI {
    execute: (sql: string, params?: unknown[]) => Promise<unknown>
    query: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]>
    queryOne: <T = unknown>(sql: string, params?: unknown[]) => Promise<T | undefined>
  }

  interface SettingsAPI {
    get: (key: string) => Promise<string | null>
    set: (key: string, value: string) => Promise<void>
    getAll: () => Promise<Record<string, string>>
  }

  interface CookieAPI {
    fetchDouyin: () => Promise<string>
  }

  interface UserProfile {
    nickname: string
    signature: string
    avatar: string
    secUid: string
    uid: string
    shortId: string
    uniqueId: string
    followingCount: number
    followerCount: number
    totalFavorited: number
    awemeCount: number
  }

  interface LinkParseResult {
    type: 'user' | 'video' | 'unknown'
    id: string
  }

  interface DouyinAPI {
    getUserProfile: (url: string) => Promise<UserProfile>
    getSecUserId: (url: string) => Promise<string>
    parseUrl: (url: string) => Promise<LinkParseResult>
  }

  interface DbUser {
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
    created_at: number
    updated_at: number
  }

  interface UpdateUserSettingsInput {
    show_in_home?: boolean
    max_download_count?: number
    remark?: string
  }

  interface BatchRefreshResult {
    success: number
    failed: number
    details: string[]
  }

  interface UserAPI {
    getAll: () => Promise<DbUser[]>
    add: (url: string) => Promise<DbUser>
    delete: (id: number) => Promise<void>
    refresh: (id: number, url: string) => Promise<DbUser>
    batchRefresh: (
      users: { id: number; homepage_url: string; nickname: string }[]
    ) => Promise<BatchRefreshResult>
    setShowInHome: (id: number, show: boolean) => Promise<void>
    updateSettings: (id: number, input: UpdateUserSettingsInput) => Promise<DbUser | undefined>
    batchUpdateSettings: (
      ids: number[],
      input: Omit<UpdateUserSettingsInput, 'remark'>
    ) => Promise<void>
  }

  interface DbTask {
    id: number
    name: string
    status: 'pending' | 'running' | 'completed' | 'failed'
    concurrency: number
    total_videos: number
    downloaded_videos: number
    created_at: number
    updated_at: number
  }

  interface DbTaskWithUsers extends DbTask {
    users: DbUser[]
  }

  interface TaskAPI {
    getAll: () => Promise<DbTaskWithUsers[]>
    getById: (id: number) => Promise<DbTaskWithUsers | undefined>
    create: (input: { name: string; user_ids: number[]; concurrency?: number }) => Promise<DbTaskWithUsers>
    update: (id: number, input: { name?: string; status?: string; concurrency?: number }) => Promise<DbTaskWithUsers | undefined>
    updateUsers: (taskId: number, userIds: number[]) => Promise<DbTaskWithUsers | undefined>
    delete: (id: number) => Promise<void>
  }

  interface DownloadProgress {
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

  interface DownloadAPI {
    start: (taskId: number) => Promise<void>
    stop: (taskId: number) => Promise<void>
    isRunning: (taskId: number) => Promise<boolean>
    onProgress: (callback: (progress: DownloadProgress) => void) => () => void
  }

  interface DbPost {
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
    analysis_sexy_level: number | null
    analyzed_at: number | null
  }

  interface MediaFiles {
    type: 'video' | 'images'
    video?: string
    images?: string[]
    cover?: string
    music?: string
  }

  interface PostAuthor {
    sec_uid: string
    nickname: string
  }

  interface PostFilters {
    secUid?: string
    tags?: string[]
    minSexyLevel?: number
    maxSexyLevel?: number
    analyzedOnly?: boolean
  }

  interface PostAPI {
    getAll: (page?: number, pageSize?: number, filters?: PostFilters) => Promise<{ posts: DbPost[]; total: number; authors: PostAuthor[] }>
    getAllTags: () => Promise<string[]>
    getCoverPath: (secUid: string, folderName: string) => Promise<string | null>
    getMediaFiles: (secUid: string, folderName: string, awemeType: number) => Promise<MediaFiles | null>
  }

  interface AnalysisProgress {
    status: 'running' | 'completed' | 'failed' | 'stopped'
    currentPost: string | null
    currentIndex: number
    totalPosts: number
    analyzedCount: number
    failedCount: number
    message: string
  }

  interface UnanalyzedUserCount {
    sec_uid: string
    nickname: string
    count: number
  }

  interface UserAnalysisStats {
    sec_uid: string
    nickname: string
    total: number
    analyzed: number
    unanalyzed: number
  }

  interface TotalAnalysisStats {
    total: number
    analyzed: number
    unanalyzed: number
  }

  interface GrokAPI {
    verify: (apiKey: string, apiUrl: string) => Promise<boolean>
  }

  interface AnalysisAPI {
    start: (secUid?: string) => Promise<void>
    stop: () => Promise<void>
    isRunning: () => Promise<boolean>
    getUnanalyzedCount: (secUid?: string) => Promise<number>
    getUnanalyzedCountByUser: () => Promise<UnanalyzedUserCount[]>
    getUserStats: () => Promise<UserAnalysisStats[]>
    getTotalStats: () => Promise<TotalAnalysisStats>
    onProgress: (callback: (progress: AnalysisProgress) => void) => () => void
  }

  interface API {
    db: DatabaseAPI
    settings: SettingsAPI
    cookie: CookieAPI
    douyin: DouyinAPI
    user: UserAPI
    task: TaskAPI
    download: DownloadAPI
    post: PostAPI
    grok: GrokAPI
    analysis: AnalysisAPI
  }

  interface Window {
    electron: ElectronAPI
    api: API
  }
}
