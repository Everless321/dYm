import type { FastifyInstance } from 'fastify'
import { startDownloadTask, stopDownloadTask, isTaskRunning } from '../services/downloader.js'

export function registerDownloadRoutes(server: FastifyInstance): void {
  server.post<{ Params: { taskId: string } }>('/api/download/:taskId/start', async (request) => {
    try {
      const taskId = parseInt(request.params.taskId)
      startDownloadTask(taskId)
      return { success: true, data: null }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.post<{ Params: { taskId: string } }>('/api/download/:taskId/stop', async (request) => {
    try {
      const taskId = parseInt(request.params.taskId)
      stopDownloadTask(taskId)
      return { success: true, data: null }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.get<{ Params: { taskId: string } }>('/api/download/:taskId/status', async (request) => {
    try {
      const taskId = parseInt(request.params.taskId)
      const running = isTaskRunning(taskId)
      return { success: true, data: running }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
