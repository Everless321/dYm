import type { ApiResponse } from '@dym/shared'

const BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {}
  if (options?.body) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, { headers, ...options })
  const json = (await res.json()) as ApiResponse<T>
  if (!json.success) throw new Error(json.error || 'Request failed')
  return json.data as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' })
}

// ============ Settings ============
export const settingsApi = {
  get: (key: string) => api.get<string | null>(`/settings/${key}`),
  set: (key: string, value: string) => api.put<void>(`/settings/${key}`, { value }),
  getAll: () => api.get<Record<string, string>>('/settings')
}

// ============ Users ============
import type {
  DbUser,
  UpdateUserSettingsInput,
  BatchRefreshResult
} from '@dym/shared'

export const usersApi = {
  getAll: () => api.get<DbUser[]>('/users'),
  add: (url: string) => api.post<DbUser>('/users', { url }),
  delete: (id: number) => api.delete<void>(`/users/${id}`),
  refresh: (id: number) => api.post<DbUser>(`/users/${id}/refresh`),
  batchRefresh: (users: { id: number; homepage_url: string; nickname: string }[]) =>
    api.post<BatchRefreshResult>('/users/batch-refresh', { users }),
  updateSettings: (id: number, input: UpdateUserSettingsInput) =>
    api.put<DbUser | undefined>(`/users/${id}/settings`, input),
  batchUpdateSettings: (
    ids: number[],
    input: Omit<UpdateUserSettingsInput, 'remark'>
  ) => api.put<void>('/users/batch-settings', { ids, ...input })
}

// ============ Tasks ============
import type { DbTaskWithUsers, CreateTaskInput, UpdateTaskInput } from '@dym/shared'

export const tasksApi = {
  getAll: () => api.get<DbTaskWithUsers[]>('/tasks'),
  getById: (id: number) => api.get<DbTaskWithUsers>(`/tasks/${id}`),
  create: (input: CreateTaskInput) => api.post<DbTaskWithUsers>('/tasks', input),
  update: (id: number, input: UpdateTaskInput) =>
    api.put<DbTaskWithUsers | undefined>(`/tasks/${id}`, input),
  updateUsers: (taskId: number, userIds: number[]) =>
    api.put<DbTaskWithUsers | undefined>(`/tasks/${taskId}/users`, { userIds }),
  delete: (id: number) => api.delete<void>(`/tasks/${id}`)
}

// ============ Posts ============
import type { DbPost, PostFilters, PostsResponse, MediaFiles } from '@dym/shared'

export const postsApi = {
  getAll: (page?: number, pageSize?: number, filters?: PostFilters) => {
    const params = new URLSearchParams()
    if (page) params.set('page', String(page))
    if (pageSize) params.set('pageSize', String(pageSize))
    if (filters) params.set('filters', JSON.stringify(filters))
    return api.get<PostsResponse>(`/posts?${params}`)
  },
  getAllTags: () => api.get<string[]>('/posts/tags'),
  getCoverUrl: (secUid: string, folderName: string) =>
    `/api/posts/${secUid}/${folderName}/cover`,
  getMediaFiles: (secUid: string, folderName: string, awemeType: number) =>
    api.get<MediaFiles | null>(`/posts/${secUid}/${folderName}/media?awemeType=${awemeType}`)
}

// ============ Download ============
export const downloadApi = {
  start: (taskId: number) => api.post<void>(`/download/${taskId}/start`),
  stop: (taskId: number) => api.post<void>(`/download/${taskId}/stop`),
  isRunning: (taskId: number) => api.get<boolean>(`/download/${taskId}/status`)
}

// ============ Sync ============
export const syncApi = {
  start: (userId: number) => api.post<void>(`/sync/${userId}/start`),
  stop: (userId: number) => api.post<void>(`/sync/${userId}/stop`),
  isRunning: (userId: number) => api.get<boolean>(`/sync/${userId}/status`),
  getAnySyncing: () => api.get<number | null>('/sync/active'),
  validateCron: (expression: string) =>
    api.post<boolean>('/sync/validate-cron', { expression })
}

// ============ Analysis ============
import type { UserAnalysisStats, TotalAnalysisStats } from '@dym/shared'

export const analysisApi = {
  start: (secUid?: string) => api.post<void>('/analysis/start', { secUid }),
  stop: () => api.post<void>('/analysis/stop'),
  isRunning: () => api.get<boolean>('/analysis/status'),
  getUnanalyzedCount: (secUid?: string) => {
    const params = secUid ? `?secUid=${secUid}` : ''
    return api.get<number>(`/analysis/unanalyzed-count${params}`)
  },
  getUserStats: () => api.get<UserAnalysisStats[]>('/analysis/user-stats'),
  getTotalStats: () => api.get<TotalAnalysisStats>('/analysis/total-stats')
}

// ============ Grok ============
export const grokApi = {
  verify: (apiKey: string, apiUrl: string) =>
    api.post<boolean>('/grok/verify', { apiKey, apiUrl })
}

// ============ Video ============
import type { VideoInfo } from '@dym/shared'

export const videoApi = {
  getDetail: (url: string) => api.post<VideoInfo>('/video/detail', { url }),
  downloadToFolder: (info: VideoInfo) => api.post<void>('/video/download', info)
}

// ============ Scheduler ============
import type { SchedulerLog } from '@dym/shared'

export const schedulerApi = {
  getLogs: () => api.get<SchedulerLog[]>('/scheduler/logs'),
  clearLogs: () => api.delete<void>('/scheduler/logs')
}
