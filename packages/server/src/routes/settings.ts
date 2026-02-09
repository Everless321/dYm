import type { FastifyInstance } from 'fastify'
import { getAllSettings, getSetting, setSetting } from '../database/index.js'
import { refreshDouyinHandler } from '../services/douyin.js'

export function registerSettingsRoutes(server: FastifyInstance): void {
  server.get('/api/settings', async () => {
    try {
      const settings = getAllSettings()
      return { success: true, data: settings }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.get<{ Params: { key: string } }>('/api/settings/:key', async (request) => {
    try {
      const value = getSetting(request.params.key)
      return { success: true, data: value }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.put<{ Params: { key: string }; Body: { value: string } }>('/api/settings/:key', async (request) => {
    try {
      const { key } = request.params
      const { value } = request.body as { value: string }
      setSetting(key, value)
      if (key === 'douyin_cookie') {
        refreshDouyinHandler()
      }
      return { success: true, data: null }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
