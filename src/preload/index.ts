/// <reference path="./index.d.ts" />
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const dbAPI = {
  execute: (sql: string, params?: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke('db:execute', sql, params),
  query: <T = unknown>(sql: string, params?: unknown[]): Promise<T[]> =>
    ipcRenderer.invoke('db:query', sql, params),
  queryOne: <T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined> =>
    ipcRenderer.invoke('db:queryOne', sql, params)
}

const settingsAPI = {
  get: (key: string): Promise<string | null> => ipcRenderer.invoke('settings:get', key),
  set: (key: string, value: string): Promise<void> => ipcRenderer.invoke('settings:set', key, value),
  getAll: (): Promise<Record<string, string>> => ipcRenderer.invoke('settings:getAll')
}

const cookieAPI = {
  fetchDouyin: (): Promise<string> => ipcRenderer.invoke('cookie:fetchDouyin')
}

const douyinAPI = {
  getUserProfile: (url: string): Promise<unknown> => ipcRenderer.invoke('douyin:getUserProfile', url),
  getSecUserId: (url: string): Promise<string> => ipcRenderer.invoke('douyin:getSecUserId', url),
  parseUrl: (url: string): Promise<{ type: 'user' | 'video' | 'unknown'; id: string }> =>
    ipcRenderer.invoke('douyin:parseUrl', url)
}

const userAPI = {
  getAll: (): Promise<DbUser[]> => ipcRenderer.invoke('user:getAll'),
  add: (url: string): Promise<DbUser> => ipcRenderer.invoke('user:add', url),
  delete: (id: number): Promise<void> => ipcRenderer.invoke('user:delete', id),
  refresh: (id: number, url: string): Promise<DbUser> => ipcRenderer.invoke('user:refresh', id, url),
  batchRefresh: (
    users: { id: number; homepage_url: string; nickname: string }[]
  ): Promise<{ success: number; failed: number; details: string[] }> =>
    ipcRenderer.invoke('user:batchRefresh', users),
  setShowInHome: (id: number, show: boolean): Promise<void> =>
    ipcRenderer.invoke('user:setShowInHome', id, show),
  updateSettings: (
    id: number,
    input: { show_in_home?: boolean; max_download_count?: number; remark?: string }
  ): Promise<DbUser | undefined> => ipcRenderer.invoke('user:updateSettings', id, input),
  batchUpdateSettings: (
    ids: number[],
    input: { show_in_home?: boolean; max_download_count?: number }
  ): Promise<void> => ipcRenderer.invoke('user:batchUpdateSettings', ids, input)
}

const taskAPI = {
  getAll: (): Promise<DbTaskWithUsers[]> => ipcRenderer.invoke('task:getAll'),
  getById: (id: number): Promise<DbTaskWithUsers | undefined> => ipcRenderer.invoke('task:getById', id),
  create: (input: { name: string; user_ids: number[]; concurrency?: number }): Promise<DbTaskWithUsers> =>
    ipcRenderer.invoke('task:create', input),
  update: (
    id: number,
    input: { name?: string; status?: string; concurrency?: number }
  ): Promise<DbTaskWithUsers | undefined> => ipcRenderer.invoke('task:update', id, input),
  updateUsers: (taskId: number, userIds: number[]): Promise<DbTaskWithUsers | undefined> =>
    ipcRenderer.invoke('task:updateUsers', taskId, userIds),
  delete: (id: number): Promise<void> => ipcRenderer.invoke('task:delete', id)
}

const downloadAPI = {
  start: (taskId: number): Promise<void> => ipcRenderer.invoke('download:start', taskId),
  stop: (taskId: number): Promise<void> => ipcRenderer.invoke('download:stop', taskId),
  isRunning: (taskId: number): Promise<boolean> => ipcRenderer.invoke('download:isRunning', taskId),
  onProgress: (callback: (progress: DownloadProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: DownloadProgress): void => callback(progress)
    ipcRenderer.on('download:progress', handler)
    return () => ipcRenderer.removeListener('download:progress', handler)
  }
}

const postAPI = {
  getAll: (page?: number, pageSize?: number, filters?: PostFilters): Promise<{ posts: DbPost[]; total: number; authors: PostAuthor[] }> =>
    ipcRenderer.invoke('post:getAll', page, pageSize, filters),
  getAllTags: (): Promise<string[]> => ipcRenderer.invoke('post:getAllTags'),
  getCoverPath: (secUid: string, folderName: string): Promise<string | null> =>
    ipcRenderer.invoke('post:getCoverPath', secUid, folderName),
  getMediaFiles: (secUid: string, folderName: string, awemeType: number): Promise<MediaFiles | null> =>
    ipcRenderer.invoke('post:getMediaFiles', secUid, folderName, awemeType),
  openFolder: (secUid: string, folderName: string): Promise<void> =>
    ipcRenderer.invoke('post:openFolder', secUid, folderName)
}

const grokAPI = {
  verify: (apiKey: string, apiUrl: string): Promise<boolean> =>
    ipcRenderer.invoke('grok:verify', apiKey, apiUrl)
}

const analysisAPI = {
  start: (secUid?: string): Promise<void> => ipcRenderer.invoke('analysis:start', secUid),
  stop: (): Promise<void> => ipcRenderer.invoke('analysis:stop'),
  isRunning: (): Promise<boolean> => ipcRenderer.invoke('analysis:isRunning'),
  getUnanalyzedCount: (secUid?: string): Promise<number> =>
    ipcRenderer.invoke('analysis:getUnanalyzedCount', secUid),
  getUnanalyzedCountByUser: (): Promise<{ sec_uid: string; nickname: string; count: number }[]> =>
    ipcRenderer.invoke('analysis:getUnanalyzedCountByUser'),
  getUserStats: (): Promise<UserAnalysisStats[]> => ipcRenderer.invoke('analysis:getUserStats'),
  getTotalStats: (): Promise<TotalAnalysisStats> => ipcRenderer.invoke('analysis:getTotalStats'),
  onProgress: (callback: (progress: AnalysisProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: AnalysisProgress): void =>
      callback(progress)
    ipcRenderer.on('analysis:progress', handler)
    return () => ipcRenderer.removeListener('analysis:progress', handler)
  }
}

const videoAPI = {
  getDetail: (url: string): Promise<VideoInfo> => ipcRenderer.invoke('video:getDetail', url),
  downloadToFolder: (info: VideoInfo): Promise<void> => ipcRenderer.invoke('video:downloadToFolder', info)
}

const api = {
  db: dbAPI,
  settings: settingsAPI,
  cookie: cookieAPI,
  douyin: douyinAPI,
  user: userAPI,
  task: taskAPI,
  download: downloadAPI,
  post: postAPI,
  grok: grokAPI,
  analysis: analysisAPI,
  video: videoAPI
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
