import type { FastifyInstance } from 'fastify'
import { getUserById } from '../database/index.js'
import { startUserSync, stopUserSync, isUserSyncing, getAnyUserSyncing } from '../services/syncer.js'
import { validateCronExpression, scheduleUser, unscheduleUser } from '../services/scheduler.js'

export function registerSyncRoutes(server: FastifyInstance): void {
  server.post<{ Params: { userId: string } }>('/api/sync/:userId/start', async (request) => {
    try {
      const userId = parseInt(request.params.userId)
      startUserSync(userId)
      return { success: true, data: null }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.post<{ Params: { userId: string } }>('/api/sync/:userId/stop', async (request) => {
    try {
      const userId = parseInt(request.params.userId)
      stopUserSync(userId)
      return { success: true, data: null }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.get<{ Params: { userId: string } }>('/api/sync/:userId/status', async (request) => {
    try {
      const userId = parseInt(request.params.userId)
      const syncing = isUserSyncing(userId)
      return { success: true, data: syncing }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.get('/api/sync/active', async () => {
    try {
      const userId = getAnyUserSyncing()
      return { success: true, data: userId ?? null }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.post<{ Body: { expression: string } }>('/api/sync/validate-cron', async (request) => {
    try {
      const { expression } = request.body as { expression: string }
      const valid = validateCronExpression(expression)
      return { success: true, data: valid }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.post<{ Params: { userId: string } }>('/api/sync/:userId/schedule', async (request) => {
    try {
      const userId = parseInt(request.params.userId)
      const user = getUserById(userId)
      if (!user) throw new Error('用户不存在')

      if (user.auto_sync && user.sync_cron) {
        scheduleUser(user)
      } else {
        unscheduleUser(userId)
      }
      return { success: true, data: null }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
