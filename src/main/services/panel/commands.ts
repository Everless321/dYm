import { existsSync, statSync } from 'fs'
import { rm } from 'fs/promises'
import { basename, extname, join, resolve } from 'path'
import type { PanelCounts, PanelLogin, PanelMediaRef, PanelMediaStat } from '../../../shared/panel'
import { isPanelMethod } from '../../../shared/panel'
import {
  createTask,
  deleteTask,
  deleteUser,
  getAllPosts,
  getAllTags,
  getAllTasks,
  getAllUsers,
  getTaskById,
  getDatabase,
  getSetting,
  getUserById,
  updateUserSettings,
  type DbPost,
  type DbTaskWithUsers,
  type DbUser,
  type PostFilters,
  type UpdateUserSettingsInput
} from '../../database'
import { getDouyinHandler } from '../douyin/client'
import { isTaskRunning, startDownloadTask, stopDownloadTask } from '../download/downloader'
import {
  getAllSyncingUserIds,
  isUserSyncing,
  startUserSync,
  stopUserSync
} from '../download/syncer'
import { findMediaFiles, fromUrlPath, getDownloadPath, isPathInDownloadRoot } from '../media'
import { validateCronExpression } from '../scheduler'
import { getLiveOutputPath, stopLiveRecordingAndWait } from '../live/recorder'
import { addUserByUrl } from '../users/add'
import { refreshUserProfile } from '../users/refresh'
import { takeDownloadProgress, takeSyncProgress } from './progress'

const LOGIN_COOKIE = /(?:^|;\s*)(?:sessionid|sessionid_ss|sid_tt|sid_guard)=/
const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4'
}

export function readLocalLogin(): PanelLogin {
  const cookie = getSetting('douyin_cookie') || ''
  return {
    loggedIn: LOGIN_COOKIE.test(cookie),
    nickname: null,
    uniqueId: null
  }
}

export function resolvePanelMediaFile(token: string): string {
  let decoded = ''
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8')
  } catch {
    throw new Error('无效的文件参数')
  }
  if (!decoded) throw new Error('无效的文件参数')
  const file = resolve(fromUrlPath(decoded))
  if (!isPathInDownloadRoot(file)) throw new Error('禁止访问该路径')
  return file
}

export async function dispatchPanelCommand(method: string, params: unknown): Promise<unknown> {
  if (!isPanelMethod(method)) throw new Error('不支持的操作')
  const input = asRecord(params)
  switch (method) {
    case 'status.get':
      return { login: readLocalLogin(), counts: readCounts() }
    case 'account.get':
      return readAccount()
    case 'users.list':
      return { users: getAllUsers().map(toUser) }
    case 'users.add':
      return addUser(input)
    case 'users.delete':
      return removeUser(input)
    case 'users.refresh':
      return refreshUser(asId(input.id))
    case 'users.updateSettings':
      return saveUserSettings(input)
    case 'users.sync':
      return beginSync(asId(input.id))
    case 'users.stopSync':
      stopUserSync(asId(input.id))
      return { ok: true }
    case 'posts.list':
      return listPosts(input)
    case 'tags.list':
      return { tags: getAllTags() }
    case 'tasks.list':
      return { tasks: getAllTasks().map(toTask) }
    case 'tasks.create':
      return toTask(createDownloadTask(input))
    case 'tasks.delete':
      return removeTask(asId(input.id))
    case 'tasks.start':
      return beginTask(asId(input.id))
    case 'tasks.stop':
      stopDownloadTask(asId(input.id))
      return { ok: true }
    case 'media.stat':
      return statMedia(typeof input.token === 'string' ? input.token : '')
    default:
      throw new Error('不支持的操作')
  }
}

async function readAccount(): Promise<PanelLogin> {
  const local = readLocalLogin()
  if (!local.loggedIn) return local
  const handler = getDouyinHandler()
  if (!handler) return local
  try {
    const user = await handler.fetchQueryUser()
    return {
      loggedIn: Boolean(user.userUid),
      nickname: null,
      uniqueId: user.userUniqueId || null
    }
  } catch (error) {
    console.error('[Panel] 读取登录账号失败:', error)
    return local
  }
}

function readCounts(): PanelCounts {
  const database = getDatabase()
  const users = database.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
  const posts = database.prepare('SELECT COUNT(*) as count FROM posts').get() as { count: number }
  return {
    users: users.count,
    posts: posts.count,
    runningTasks: getAllTasks().filter((task) => isTaskRunning(task.id)).length,
    syncingUsers: getAllSyncingUserIds().length
  }
}

async function addUser(input: Record<string, unknown>): Promise<unknown> {
  const url = requireText(input.url, '请填写用户或作品链接', 2000)
  const result = await addUserByUrl(url)
  return {
    isNewUser: result.isNewUser,
    postDownload: result.postDownload,
    user: toUser(result.user)
  }
}

async function removeUser(input: Record<string, unknown>): Promise<{ ok: true }> {
  const id = asId(input.id)
  if (isUserSyncing(id)) stopUserSync(id)
  await stopLiveRecordingAndWait(id)
  const removed = deleteUser(id)
  if (!removed) throw new Error('用户不存在')
  if (input.deleteFiles === true) {
    const dirs = [
      join(getDownloadPath(), removed.sec_uid),
      join(getLiveOutputPath(), removed.sec_uid)
    ]
    for (const dir of dirs) {
      if (!existsSync(dir)) continue
      await rm(dir, { recursive: true, force: true })
    }
  }
  return { ok: true }
}

async function refreshUser(id: number): Promise<unknown> {
  const outcome = await refreshUserProfile(id)
  if (outcome.status === 'failed' || !outcome.user) {
    throw new Error(outcome.error || '刷新失败')
  }
  return { status: outcome.status, user: toUser(outcome.user) }
}

function saveUserSettings(input: Record<string, unknown>): unknown {
  const id = asId(input.id)
  const patch: UpdateUserSettingsInput = {}
  if (typeof input.showInHome === 'boolean') patch.show_in_home = input.showInHome
  if (typeof input.maxDownloadCount === 'number' && Number.isFinite(input.maxDownloadCount)) {
    patch.max_download_count = Math.max(0, Math.min(100_000, Math.floor(input.maxDownloadCount)))
  }
  if (typeof input.remark === 'string') patch.remark = input.remark.slice(0, 200)
  if (typeof input.autoSync === 'boolean') patch.auto_sync = input.autoSync
  if (typeof input.syncCron === 'string') {
    const cron = input.syncCron.trim().slice(0, 100)
    if (cron && !validateCronExpression(cron)) throw new Error('同步计划不是合法的 Cron 表达式')
    patch.sync_cron = cron
  }
  const user = updateUserSettings(id, patch)
  if (!user) throw new Error('用户不存在')
  return { user: toUser(user) }
}

function beginSync(id: number): { started: boolean; syncing: boolean } {
  if (!getUserById(id)) throw new Error('用户不存在')
  requireDouyinLogin()
  if (isUserSyncing(id)) return { started: false, syncing: true }
  void startUserSync(id, { source: 'manual' }).catch((error) => {
    console.error('[Panel] 同步失败:', error)
  })
  return { started: true, syncing: true }
}

function listPosts(input: Record<string, unknown>): unknown {
  const page = clampInt(input.page, 1, 100_000, 1)
  const pageSize = clampInt(input.pageSize, 1, 48, 24)
  const filters: PostFilters = { includeHidden: true }
  if (typeof input.secUid === 'string' && input.secUid.trim()) {
    filters.secUid = input.secUid.trim().slice(0, 200)
  }
  if (typeof input.keyword === 'string' && input.keyword.trim()) {
    filters.keyword = input.keyword.trim().slice(0, 100)
  }
  if (typeof input.tag === 'string' && input.tag.trim()) {
    filters.tags = [input.tag.trim().slice(0, 100)]
  }
  if (input.analyzedOnly === true) filters.analyzedOnly = true
  const result = getAllPosts(page, pageSize, filters, { field: 'downloaded_at', order: 'DESC' })
  return {
    page,
    pageSize,
    total: result.total,
    hasMore: page * pageSize < result.total,
    authors: result.authors.map((author) => ({
      secUid: author.sec_uid,
      nickname: author.nickname
    })),
    posts: result.posts.map(toPost)
  }
}

function createDownloadTask(input: Record<string, unknown>): DbTaskWithUsers {
  const name = requireText(input.name, '请填写任务名称', 80)
  if (!Array.isArray(input.userIds) || input.userIds.length === 0) {
    throw new Error('请选择至少一个用户')
  }
  if (input.userIds.length > 500) throw new Error('一次最多选择 500 个用户')
  const userIds = input.userIds.map((id) => asId(id))
  const concurrency = clampInt(input.concurrency, 1, 8, 3)
  return createTask({ name, user_ids: userIds, concurrency })
}

function removeTask(id: number): { ok: true } {
  if (isTaskRunning(id)) stopDownloadTask(id)
  deleteTask(id)
  return { ok: true }
}

function beginTask(id: number): { started: boolean; running: boolean } {
  if (!getTaskById(id)) throw new Error('任务不存在')
  requireDouyinLogin()
  if (isTaskRunning(id)) return { started: false, running: true }
  void startDownloadTask(id, { source: 'manual' }).catch((error) => {
    console.error('[Panel] 下载任务失败:', error)
  })
  return { started: true, running: true }
}

function requireDouyinLogin(): void {
  if (!(getSetting('douyin_cookie') || '').trim()) {
    throw new Error('这台客户端还没有登录抖音')
  }
}

function statMedia(token: string): PanelMediaStat {
  if (!token) return { kind: 'missing' }
  let file = ''
  try {
    file = resolvePanelMediaFile(token)
  } catch {
    return { kind: 'missing' }
  }
  if (!existsSync(file)) return { kind: 'missing' }
  const info = statSync(file)
  if (!info.isFile()) return { kind: 'missing' }
  return {
    kind: 'file',
    size: info.size,
    mime: MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    name: basename(file)
  }
}

interface PanelUserView {
  id: number
  secUid: string
  nickname: string
  uniqueId: string
  remark: string
  signature: string
  avatar: PanelMediaRef | null
  downloadedCount: number
  awemeCount: number
  followerCount: number
  syncStatus: DbUser['sync_status']
  syncing: boolean
  autoSync: boolean
  syncCron: string
  maxDownloadCount: number
  showInHome: boolean
  homepageUrl: string
  lastSyncAt: number | null
  progress: object | null
}

function toUser(user: DbUser): PanelUserView {
  return {
    id: user.id,
    secUid: user.sec_uid,
    nickname: user.nickname,
    uniqueId: user.unique_id,
    remark: user.remark,
    signature: user.signature,
    avatar: toMediaRef(user.avatar_path) ?? toRemote(user.avatar),
    downloadedCount: user.downloaded_count,
    awemeCount: user.aweme_count,
    followerCount: user.follower_count,
    syncStatus: user.sync_status,
    syncing: isUserSyncing(user.id),
    autoSync: user.auto_sync === 1,
    syncCron: user.sync_cron,
    maxDownloadCount: user.max_download_count,
    showInHome: user.show_in_home === 1,
    homepageUrl: user.homepage_url,
    lastSyncAt: user.last_sync_at,
    progress: takeSyncProgress(user.id)
  }
}

interface PanelTaskView {
  id: number
  name: string
  status: DbTaskWithUsers['status']
  concurrency: number
  totalVideos: number
  downloadedVideos: number
  running: boolean
  autoSync: boolean
  syncCron: string
  lastSyncAt: number | null
  updatedAt: number
  users: Array<{ id: number; nickname: string }>
  progress: object | null
}

function toTask(task: DbTaskWithUsers): PanelTaskView {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    concurrency: task.concurrency,
    totalVideos: task.total_videos,
    downloadedVideos: task.downloaded_videos,
    running: isTaskRunning(task.id),
    autoSync: task.auto_sync === 1,
    syncCron: task.sync_cron,
    lastSyncAt: task.last_sync_at,
    updatedAt: task.updated_at,
    users: task.users.map((user) => ({ id: user.id, nickname: user.nickname })),
    progress: takeDownloadProgress(task.id)
  }
}

interface PanelPostView {
  id: number
  awemeId: string
  caption: string
  desc: string
  createTime: string
  awemeType: number
  isImagePost: boolean
  author: { nickname: string; secUid: string }
  cover: PanelMediaRef | null
  video: PanelMediaRef | null
  images: PanelMediaRef[]
  analysis: {
    tags: string[]
    category: string | null
    summary: string | null
    contentLevel: number | null
  }
}

function toPost(post: DbPost): PanelPostView {
  const media = post.folder_name
    ? findMediaFiles(post.sec_uid, post.folder_name, post.aweme_type)
    : null
  return {
    id: post.id,
    awemeId: post.aweme_id,
    caption: post.caption,
    desc: post.desc,
    createTime: post.create_time,
    awemeType: post.aweme_type,
    isImagePost: post.aweme_type === 68,
    author: { nickname: post.nickname, secUid: post.sec_uid },
    cover: toMediaRef(media?.cover ?? null),
    video: toMediaRef(media?.video ?? null),
    images: (media?.images ?? []).map((image) => toMediaRef(image)).filter(isMedia),
    analysis: {
      tags: mergeTags(post.analysis_tags, post.manual_tags),
      category: post.analysis_category,
      summary: post.analysis_summary,
      contentLevel: post.analysis_content_level
    }
  }
}

function toMediaRef(filePath: string | null | undefined): PanelMediaRef | null {
  if (!filePath) return null
  if (/^https?:\/\//i.test(filePath)) return { kind: 'remote', url: filePath }
  const absolute = resolve(fromUrlPath(filePath))
  if (!isPathInDownloadRoot(absolute) || !existsSync(absolute)) return null
  return { kind: 'file', token: Buffer.from(absolute).toString('base64url') }
}

function toRemote(url: string | null | undefined): PanelMediaRef | null {
  if (!url || !/^https?:\/\//i.test(url)) return null
  return { kind: 'remote', url }
}

function isMedia(value: PanelMediaRef | null): value is PanelMediaRef {
  return value !== null
}

function mergeTags(analysis: string | null, manual: string | null): string[] {
  return [...new Set([...parseTags(analysis), ...parseTags(manual)])]
}

function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === 'string') : []
  } catch {
    return []
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function asId(value: unknown): number {
  const id = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new Error('编号不正确')
  return id
}

function requireText(value: unknown, message: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
  return value.trim().slice(0, max)
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}
