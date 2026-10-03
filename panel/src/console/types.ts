export interface PanelLogin {
  loggedIn: boolean
  nickname: string | null
  uniqueId: string | null
}

export interface PanelCounts {
  users: number
  posts: number
  runningTasks: number
  syncingUsers: number
}

export interface PanelNode {
  id: string
  name: string
  online: boolean
  hostname: string
  version: string
  platform: string
  lastSeen: number | null
  login: PanelLogin
  counts: PanelCounts
  keyId: string
  keyPrefix: string
}

export interface PanelKey {
  id: string
  name: string
  prefix: string
  createdAt: number
  nodeId: string
  online: boolean
}

export interface MediaRef {
  kind: 'file' | 'remote'
  token?: string
  url?: string
}

export interface PanelPost {
  id: number
  awemeId: string
  caption: string
  desc: string
  isImagePost: boolean
  author?: { nickname: string; secUid: string }
  cover: MediaRef | null
  video: MediaRef | null
  images: MediaRef[]
  imageVideos?: Array<MediaRef | null>
  music?: MediaRef | null
  analysis?: {
    tags?: string[]
    summary?: string | null
  }
}

export interface PanelUser {
  id: number
  nickname: string
  uniqueId: string
  remark: string
  avatar: MediaRef | null
  downloadedCount: number
  awemeCount: number
  followerCount: number
  syncStatus: string
  syncing: boolean
  autoSync: boolean
  syncCron: string
  maxDownloadCount: number
  showInHome: boolean
  homepageUrl?: string
  lastSyncAt?: number | null
  signature?: string
}

export interface PanelTask {
  id: number
  name: string
  status: string
  concurrency?: number
  totalVideos: number
  downloadedVideos: number
  running: boolean
  autoSync?: boolean
  syncCron?: string
  lastSyncAt?: number | null
  users: Array<{ id: number; nickname: string }>
  progress: { message?: string; status?: string } | null
}

export interface PostAuthor {
  secUid: string
  nickname: string
}

export interface PostListResult {
  page: number
  pageSize: number
  total: number
  hasMore: boolean
  authors: PostAuthor[]
  posts: PanelPost[]
}

export interface LiveSync {
  userId: number
  message?: string
  status?: string
}

export interface LiveDownload {
  taskId: number
  message?: string
  status?: string
}

export interface PostQuery {
  page: number
  keyword: string
  secUid: string
  tag: string
  analyzedOnly: boolean
}

export const EMPTY_POST_QUERY: PostQuery = {
  page: 1,
  keyword: '',
  secUid: '',
  tag: '',
  analyzedOnly: false
}

export type NodeTab = 'posts' | 'users' | 'tasks'

export type Route = { name: 'list' } | { name: 'node'; id: string; tab: NodeTab }
