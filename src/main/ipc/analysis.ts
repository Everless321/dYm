import { ipcMain } from 'electron'
import {
  getUnanalyzedPostsCount,
  getUnanalyzedPostsCountByUser,
  getUserAnalysisStats,
  getTotalAnalysisStats,
  getTagOverviewStats,
  getUserTagStats,
  getTagLibraryStats,
  getTagsWithFrequency,
  getTagCategories,
  queryPostsForTags,
  queryPostIdsForTags,
  getTagFilterFacets,
  addTagsToPosts,
  getPostById,
  setPostTags,
  clearTags,
  renameTag,
  mergeTags,
  deleteTags,
  addCustomTag,
  getTagAliases,
  addTagAlias,
  removeTagAlias,
  type ClearTagScope,
  type TagPostFilters
} from '../database'
import {
  listProviders,
  saveProvider,
  deleteProvider,
  setDefaultProvider,
  verifyProvider,
  listProviderModels,
  getCodexStatus,
  codexLogin,
  codexCancelLogin,
  codexImportFromCli,
  codexLogout,
  createJob,
  listJobs,
  getJob,
  getJobItems,
  pauseJob,
  resumeJob,
  cancelJob,
  retryFailed,
  deleteJob,
  getAnalysisSettings,
  saveAnalysisSettings
} from '../services/ai'
import type {
  AiProviderInput,
  AnalysisJobItemStatus,
  AnalysisSettings,
  CreateAnalysisJobInput
} from '../../shared/ai'
import { track } from '../services/telemetry'

export function registerAnalysisIpc(): void {
  // ---- AI 提供方 ----
  ipcMain.handle('ai:listProviders', () => listProviders())
  ipcMain.handle('ai:saveProvider', (_event, input: AiProviderInput) => saveProvider(input))
  ipcMain.handle('ai:deleteProvider', (_event, id: string) => deleteProvider(id))
  ipcMain.handle('ai:setDefaultProvider', (_event, id: string) => setDefaultProvider(id))
  ipcMain.handle('ai:verifyProvider', (_event, input: AiProviderInput) => verifyProvider(input))
  ipcMain.handle('ai:listModels', (_event, input: AiProviderInput) => listProviderModels(input))
  ipcMain.handle('ai:codexStatus', (_event, providerId: string) => getCodexStatus(providerId))
  ipcMain.handle('ai:codexLogin', (_event, providerId: string) => codexLogin(providerId))
  ipcMain.handle('ai:codexCancelLogin', () => codexCancelLogin())
  ipcMain.handle('ai:codexImportFromCli', (_event, providerId: string) =>
    codexImportFromCli(providerId)
  )
  ipcMain.handle('ai:codexLogout', (_event, providerId: string) => codexLogout(providerId))

  // ---- 分析队列 ----
  ipcMain.handle('analysis:getSettings', () => getAnalysisSettings())
  ipcMain.handle('analysis:saveSettings', (_event, patch: Partial<AnalysisSettings>) =>
    saveAnalysisSettings(patch)
  )
  ipcMain.handle('analysis:createJob', (_event, input: CreateAnalysisJobInput) => {
    track('analysis_started')
    return createJob(input)
  })
  ipcMain.handle('analysis:listJobs', () => listJobs())
  ipcMain.handle('analysis:getJob', (_event, id: number) => getJob(id))
  ipcMain.handle(
    'analysis:getJobItems',
    (
      _event,
      id: number,
      filter?: { status?: AnalysisJobItemStatus; page?: number; pageSize?: number }
    ) => getJobItems(id, filter)
  )
  ipcMain.handle('analysis:pauseJob', (_event, id: number) => pauseJob(id))
  ipcMain.handle('analysis:resumeJob', (_event, id: number) => resumeJob(id))
  ipcMain.handle('analysis:cancelJob', (_event, id: number) => cancelJob(id))
  ipcMain.handle('analysis:retryFailed', (_event, id: number) => retryFailed(id))
  ipcMain.handle('analysis:deleteJob', (_event, id: number) => deleteJob(id))
  ipcMain.handle('analysis:getUnanalyzedCount', (_event, secUid?: string) =>
    getUnanalyzedPostsCount(secUid)
  )
  ipcMain.handle('analysis:getUnanalyzedCountByUser', () => getUnanalyzedPostsCountByUser())
  ipcMain.handle('analysis:getUserStats', () => getUserAnalysisStats())
  ipcMain.handle('analysis:getTotalStats', () => getTotalAnalysisStats())

  // ---- 标签 ----
  ipcMain.handle('tag:getOverviewStats', () => getTagOverviewStats())
  ipcMain.handle('tag:getUserStats', () => getUserTagStats())
  ipcMain.handle('tag:getLibraryStats', () => getTagLibraryStats())
  ipcMain.handle('tag:getTagsWithFrequency', (_event, secUid?: string) =>
    getTagsWithFrequency(secUid)
  )
  ipcMain.handle('tag:getCategories', () => getTagCategories())
  ipcMain.handle('tag:getFilterFacets', (_event, filters?: TagPostFilters) =>
    getTagFilterFacets(filters)
  )
  ipcMain.handle('tag:getPost', (_event, postId: number) => getPostById(postId))
  ipcMain.handle(
    'tag:queryPosts',
    (_event, filters?: TagPostFilters, page?: number, pageSize?: number) =>
      queryPostsForTags(filters, page, pageSize)
  )
  ipcMain.handle('tag:queryPostIds', (_event, filters?: TagPostFilters) =>
    queryPostIdsForTags(filters)
  )
  ipcMain.handle('tag:addTags', (_event, postIds: number[], tags: string[]) =>
    addTagsToPosts(postIds, tags)
  )
  ipcMain.handle(
    'tag:setPostTags',
    (_event, postId: number, input: { aiTags?: string[]; manualTags?: string[] }) =>
      setPostTags(postId, input)
  )
  ipcMain.handle('tag:clear', (_event, postIds: number[], scope: ClearTagScope) =>
    clearTags(postIds, scope)
  )
  ipcMain.handle('tag:rename', (_event, oldName: string, newName: string) =>
    renameTag(oldName, newName)
  )
  ipcMain.handle('tag:merge', (_event, names: string[], into: string) => mergeTags(names, into))
  ipcMain.handle('tag:delete', (_event, names: string[]) => deleteTags(names))
  ipcMain.handle('tag:addCustomTag', (_event, name: string) => addCustomTag(name))
  ipcMain.handle('tag:getAliases', () => getTagAliases())
  ipcMain.handle('tag:addAlias', (_event, alias: string, tag: string) => addTagAlias(alias, tag))
  ipcMain.handle('tag:removeAlias', (_event, alias: string) => removeTagAlias(alias))
}
