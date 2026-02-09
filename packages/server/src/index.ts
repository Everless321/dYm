import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initDatabase, getSetting } from './database/index.js'
import { initDouyinHandler } from './services/douyin.js'
import { initScheduler } from './services/scheduler.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerUserRoutes } from './routes/users.js'
import { registerTaskRoutes } from './routes/tasks.js'
import { registerPostRoutes } from './routes/posts.js'
import { registerDownloadRoutes } from './routes/download.js'
import { registerSyncRoutes } from './routes/sync.js'
import { registerAnalysisRoutes } from './routes/analysis.js'
import { registerSystemRoutes } from './routes/system.js'
import { registerWsHandler } from './ws/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const server = Fastify({ logger: true })

async function start(): Promise<void> {
  // Initialize core services first (DB must be ready before getSetting)
  initDatabase()
  initDouyinHandler()
  initScheduler()

  // Plugins
  await server.register(cors, { origin: true })
  await server.register(fastifyWebsocket)

  // Static file serving for media
  const downloadPath = getMediaBasePath()
  await server.register(fastifyStatic, {
    root: downloadPath,
    prefix: '/media/',
    decorateReply: true,
    acceptRanges: true
  })

  // Register REST routes
  registerSettingsRoutes(server)
  registerUserRoutes(server)
  registerTaskRoutes(server)
  registerPostRoutes(server)
  registerDownloadRoutes(server)
  registerSyncRoutes(server)
  registerAnalysisRoutes(server)
  registerSystemRoutes(server)

  // Register WebSocket
  registerWsHandler(server)

  // Start server
  const port = parseInt(process.env.PORT || '4000')
  await server.listen({ port, host: '0.0.0.0' })
  console.log(`[Server] Running on http://localhost:${port}`)
}

function getMediaBasePath(): string {
  const customPath = getSetting('download_path')
  if (customPath?.trim()) return customPath
  return join(process.env.DYM_DATA_DIR!, 'Download', 'post')
}

start().catch((err) => {
  console.error('[Server] Fatal error:', err)
  process.exit(1)
})
