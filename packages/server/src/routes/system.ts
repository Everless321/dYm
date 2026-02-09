import type { FastifyInstance } from 'fastify'
import os from 'os'
import { join } from 'path'
import { createWriteStream } from 'fs'
import { mkdir } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { getSetting } from '../database/index.js'
import { fetchVideoDetail } from '../services/douyin.js'
import { getSchedulerLogs, clearSchedulerLogs } from '../services/scheduler.js'

let lastCpuInfo = os.cpus()

export function registerSystemRoutes(server: FastifyInstance): void {
  server.get('/api/system/resources', async () => {
    try {
      const currentCpuInfo = os.cpus()

      let totalIdle = 0
      let totalTick = 0

      for (let i = 0; i < currentCpuInfo.length; i++) {
        const cpu = currentCpuInfo[i]
        const lastCpu = lastCpuInfo[i]

        const idleDiff = cpu.times.idle - lastCpu.times.idle
        const totalDiff =
          cpu.times.user - lastCpu.times.user +
          cpu.times.nice - lastCpu.times.nice +
          cpu.times.sys - lastCpu.times.sys +
          cpu.times.idle - lastCpu.times.idle +
          cpu.times.irq - lastCpu.times.irq

        totalIdle += idleDiff
        totalTick += totalDiff
      }

      lastCpuInfo = currentCpuInfo

      const cpuUsage = totalTick > 0 ? Math.round(((totalTick - totalIdle) / totalTick) * 100) : 0

      const totalMem = os.totalmem()
      const freeMem = os.freemem()
      const usedMem = totalMem - freeMem
      const memoryUsage = Math.round((usedMem / totalMem) * 100)

      return {
        success: true,
        data: {
          cpuUsage: Math.min(100, Math.max(0, cpuUsage)),
          memoryUsage,
          memoryUsed: Math.round((usedMem / 1024 / 1024 / 1024) * 10) / 10,
          memoryTotal: Math.round((totalMem / 1024 / 1024 / 1024) * 10) / 10
        }
      }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.post<{ Body: { apiKey: string; apiUrl: string } }>('/api/grok/verify', async (request) => {
    try {
      const { apiKey, apiUrl } = request.body as { apiKey: string; apiUrl: string }
      const response = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'grok-2-latest',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5
        })
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error?.message || response.statusText)
      }
      return { success: true, data: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.post<{ Body: { url: string } }>('/api/video/detail', async (request) => {
    try {
      const { url } = request.body as { url: string }
      const detail = await fetchVideoDetail(url) as {
        awemeId?: string
        awemeType?: number
        desc?: string
        nickname?: string
        cover?: string
        animatedCover?: string
        videoPlayAddr?: string[]
        images?: string[]
      }

      const isImages = detail.awemeType === 68
      const coverUrl = detail.cover || detail.animatedCover || ''

      return {
        success: true,
        data: {
          awemeId: detail.awemeId || '',
          desc: detail.desc || '',
          nickname: detail.nickname || '',
          coverUrl,
          type: isImages ? 'images' : 'video',
          videoUrl: isImages ? undefined : (detail.videoPlayAddr?.[0] || ''),
          imageUrls: isImages ? (detail.images || []) : undefined
        }
      }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.post<{
    Body: {
      savePath: string
      awemeId: string
      desc: string
      nickname: string
      type: 'video' | 'images'
      videoUrl?: string
      imageUrls?: string[]
    }
  }>('/api/video/download', async (request) => {
    try {
      const info = request.body as {
        savePath: string
        awemeId: string
        desc: string
        nickname: string
        type: 'video' | 'images'
        videoUrl?: string
        imageUrls?: string[]
      }

      const folderName = `${info.nickname}_${info.awemeId}`
      const folderPath = join(info.savePath, folderName)

      await mkdir(folderPath, { recursive: true })

      const cookie = getSetting('douyin_cookie') || ''
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.douyin.com/',
        'Cookie': cookie
      }

      if (info.type === 'video' && info.videoUrl) {
        const videoPath = join(folderPath, `${info.awemeId}.mp4`)
        const response = await fetch(info.videoUrl, { headers })
        if (!response.ok || !response.body) throw new Error('下载视频失败')
        const fileStream = createWriteStream(videoPath)
        await pipeline(response.body as unknown as NodeJS.ReadableStream, fileStream)
      } else if (info.type === 'images' && info.imageUrls) {
        for (let i = 0; i < info.imageUrls.length; i++) {
          const imgUrl = info.imageUrls[i]
          const ext = imgUrl.includes('.webp') ? 'webp' : 'jpg'
          const imgPath = join(folderPath, `${info.awemeId}_${i + 1}.${ext}`)
          const response = await fetch(imgUrl, { headers })
          if (!response.ok || !response.body) continue
          const fileStream = createWriteStream(imgPath)
          await pipeline(response.body as unknown as NodeJS.ReadableStream, fileStream)
        }
      }

      return { success: true, data: { path: folderPath } }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.get('/api/scheduler/logs', async () => {
    try {
      const logs = getSchedulerLogs()
      return { success: true, data: logs }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  server.delete('/api/scheduler/logs', async () => {
    try {
      clearSchedulerLogs()
      return { success: true, data: null }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}
