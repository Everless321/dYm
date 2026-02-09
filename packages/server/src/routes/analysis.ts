import type { FastifyInstance } from 'fastify'
import { startAnalysis, stopAnalysis, isAnalysisRunning } from '../services/analyzer.js'
import { getUnanalyzedPostsCount, getUserAnalysisStats, getTotalAnalysisStats } from '../database/index.js'

export function registerAnalysisRoutes(server: FastifyInstance): void {
  server.post<{ Body: { secUid?: string } }>('/api/analysis/start', async (request) => {
    try {
      const { secUid } = (request.body || {}) as { secUid?: string }
      startAnalysis(secUid)
      return { success: true, data: null }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.post('/api/analysis/stop', async () => {
    try {
      stopAnalysis()
      return { success: true, data: null }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.get('/api/analysis/status', async () => {
    try {
      const running = isAnalysisRunning()
      return { success: true, data: running }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.get<{ Querystring: { secUid?: string } }>('/api/analysis/unanalyzed-count', async (request) => {
    try {
      const count = getUnanalyzedPostsCount(request.query.secUid)
      return { success: true, data: count }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.get('/api/analysis/user-stats', async () => {
    try {
      const stats = getUserAnalysisStats()
      return { success: true, data: stats }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.get('/api/analysis/total-stats', async () => {
    try {
      const stats = getTotalAnalysisStats()
      return { success: true, data: stats }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
