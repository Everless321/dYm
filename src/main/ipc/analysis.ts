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
  type ClearTagScope,
  type TagPostFilters
} from '../database'
import {
  startAnalysis,
  stopAnalysis,
  isAnalysisRunning,
  reanalyzePost,
  reanalyzePosts
} from '../services/analyzer'
import { track } from '../services/telemetry'

export function registerAnalysisIpc(): void {
  // Analysis IPC handlers
  ipcMain.handle('analysis:start', (_event, secUid?: string) => {
    track('analysis_started')
    return startAnalysis(secUid)
  })
  ipcMain.handle('analysis:stop', () => stopAnalysis())
  ipcMain.handle('analysis:isRunning', () => isAnalysisRunning())
  ipcMain.handle('analysis:getUnanalyzedCount', (_event, secUid?: string) =>
    getUnanalyzedPostsCount(secUid)
  )
  ipcMain.handle('analysis:getUnanalyzedCountByUser', () => getUnanalyzedPostsCountByUser())
  ipcMain.handle('analysis:getUserStats', () => getUserAnalysisStats())
  ipcMain.handle('analysis:getTotalStats', () => getTotalAnalysisStats())
  ipcMain.handle('analysis:reanalyzePost', (_event, postId: number) => reanalyzePost(postId))
  ipcMain.handle('analysis:reanalyzePosts', (_event, postIds: number[]) => reanalyzePosts(postIds))

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
}
