import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { rm, mkdir } from 'fs/promises'
import { randomUUID } from 'crypto'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'
import {
  getSetting,
  getUnanalyzedPosts,
  getUnanalyzedPostsCount,
  updatePostAnalysis,
  type DbPost,
  type AnalysisResult
} from '../database'

// 设置 ffmpeg 路径，生产环境需要处理 asar 路径
const ffmpegPath = ffmpegInstaller.path.replace('app.asar', 'app.asar.unpacked')
const ffprobePath = ffprobeInstaller.path.replace('app.asar', 'app.asar.unpacked')
ffmpeg.setFfmpegPath(ffmpegPath)
ffmpeg.setFfprobePath(ffprobePath)

export interface AnalysisProgress {
  status: 'running' | 'completed' | 'failed' | 'stopped'
  currentPost: string | null
  currentIndex: number
  totalPosts: number
  analyzedCount: number
  failedCount: number
  message: string
}

let isAnalyzing = false
let shouldStop = false

function sendProgress(progress: AnalysisProgress): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send('analysis:progress', progress)
  }
}

function getDownloadPath(): string {
  return join(app.getPath('userData'), 'Download', 'post')
}

function findMediaFolder(secUid: string, folderName: string): string | null {
  const basePath = join(getDownloadPath(), secUid)
  if (!existsSync(basePath)) return null

  const exactPath = join(basePath, folderName)
  if (existsSync(exactPath)) return exactPath

  try {
    const folders = readdirSync(basePath)
    for (const folder of folders) {
      if (folder.endsWith(folderName) || folder.includes(`_${folderName}`)) {
        return join(basePath, folder)
      }
    }
  } catch {
    return null
  }
  return null
}

function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err)
        return
      }
      const duration = metadata.format.duration
      if (typeof duration !== 'number' || duration <= 0) {
        reject(new Error('Failed to get video duration'))
        return
      }
      resolve(duration)
    })
  })
}

async function extractVideoFrames(videoPath: string, sliceCount: number): Promise<string[]> {
  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`)
  }

  const tempDir = join(app.getPath('temp'), 'dym-frames', randomUUID())
  await mkdir(tempDir, { recursive: true })

  console.log(`[Analyzer] Extracting frames from: ${videoPath}`)

  try {
    const duration = await getVideoDuration(videoPath)
    console.log(`[Analyzer] Video duration: ${duration}s, slices: ${sliceCount}`)

    const interval = duration / (sliceCount + 1)
    const timestamps: number[] = []
    for (let i = 1; i <= sliceCount; i++) {
      timestamps.push(interval * i)
    }

    // 构建 select 滤镜：按时间选择帧，每个时间点允许 0.1 秒误差
    const selectExpr = timestamps
      .map((t) => `between(t\\,${t.toFixed(2)}\\,${(t + 0.1).toFixed(2)})`)
      .join('+')

    const outputPattern = join(tempDir, 'frame_%d.jpg')

    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions([
          '-vf', `select='${selectExpr}',scale=640:-1`,
          '-vsync', 'vfr',
          '-q:v', '2',
          '-y'
        ])
        .output(outputPattern)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run()
    })

    // 收集生成的帧文件
    const frames: string[] = []
    for (let i = 1; i <= sliceCount; i++) {
      const framePath = join(tempDir, `frame_${i}.jpg`)
      if (existsSync(framePath)) {
        frames.push(framePath)
      }
    }

    if (frames.length === 0) {
      throw new Error('No frames could be extracted from video')
    }

    console.log(`[Analyzer] Extracted ${frames.length} frames in one pass`)
    return frames
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

function loadImageAsBase64(imagePath: string): string {
  const buffer = readFileSync(imagePath)
  const ext = imagePath.split('.').pop()?.toLowerCase() || 'jpg'
  const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

async function cleanupTempFrames(framePaths: string[]): Promise<void> {
  if (framePaths.length === 0) return
  const tempDir = join(framePaths[0], '..')
  await rm(tempDir, { recursive: true, force: true }).catch(() => {})
}

class RateLimiter {
  private timestamps: number[] = []
  private rpm: number

  constructor(rpm: number) {
    this.rpm = rpm
  }

  async wait(): Promise<void> {
    const now = Date.now()
    const oneMinuteAgo = now - 60000

    this.timestamps = this.timestamps.filter((t) => t > oneMinuteAgo)

    if (this.timestamps.length >= this.rpm) {
      const oldestInWindow = this.timestamps[0]
      const waitTime = oldestInWindow + 60000 - now
      if (waitTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitTime))
      }
    }

    this.timestamps.push(Date.now())
  }

  updateRpm(rpm: number): void {
    this.rpm = rpm
  }
}

async function callVisionAPI(
  images: string[],
  prompt: string,
  apiKey: string,
  apiUrl: string,
  model: string
): Promise<AnalysisResult> {
  const imageContents = images.map((img) => ({
    type: 'image_url',
    image_url: { url: img }
  }))

  const response = await fetch(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }, ...imageContents]
        }
      ],
      temperature: 0.3,
      max_tokens: 1024
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content

  if (!content) {
    throw new Error('Empty response from API')
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('No JSON found in response')
  }

  const result = JSON.parse(jsonMatch[0])
  return {
    tags: Array.isArray(result.tags) ? result.tags : [],
    category: result.category || '',
    summary: result.summary || '',
    scene: result.scene || '',
    sexy_level: typeof result.sexy_level === 'number' ? result.sexy_level : 0
  }
}

async function analyzePost(
  post: DbPost,
  sliceCount: number,
  rateLimiter: RateLimiter,
  apiKey: string,
  apiUrl: string,
  model: string,
  prompt: string
): Promise<AnalysisResult> {
  const mediaFolder = findMediaFolder(post.sec_uid, post.folder_name)
  if (!mediaFolder) {
    throw new Error('Media folder not found')
  }

  let images: string[] = []
  let tempFrames: string[] = []

  try {
    const files = readdirSync(mediaFolder)

    if (post.aweme_type === 68) {
      const imageFiles = files
        .filter((f) => /\.(webp|jpg|jpeg|png)$/i.test(f) && !f.includes('_cover'))
        .sort()
        .map((f) => join(mediaFolder, f))

      images = imageFiles.slice(0, 10).map((p) => loadImageAsBase64(p))
    } else {
      const videoFile = files.find((f) => /\.(mp4|mov|avi)$/i.test(f))
      if (!videoFile) {
        throw new Error('Video file not found')
      }

      const videoPath = join(mediaFolder, videoFile)
      tempFrames = await extractVideoFrames(videoPath, sliceCount)
      images = tempFrames.map((p) => loadImageAsBase64(p))
    }

    if (images.length === 0) {
      throw new Error('No images to analyze')
    }

    await rateLimiter.wait()
    const result = await callVisionAPI(images, prompt, apiKey, apiUrl, model)
    return result
  } finally {
    if (tempFrames.length > 0) {
      await cleanupTempFrames(tempFrames)
    }
  }
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  onComplete?: (index: number, result: T | Error) => void
): Promise<(T | Error)[]> {
  const results: (T | Error)[] = new Array(tasks.length)
  let currentIndex = 0

  const runNext = async (): Promise<void> => {
    while (currentIndex < tasks.length) {
      if (shouldStop) break
      const index = currentIndex++
      try {
        const result = await tasks[index]()
        results[index] = result
        onComplete?.(index, result)
      } catch (error) {
        results[index] = error as Error
        onComplete?.(index, error as Error)
      }
    }
  }

  const workers = Array(Math.min(concurrency, tasks.length))
    .fill(null)
    .map(() => runNext())

  await Promise.all(workers)
  return results
}

export async function startAnalysis(secUid?: string): Promise<void> {
  if (isAnalyzing) {
    throw new Error('分析任务正在进行中')
  }

  const apiKey = getSetting('grok_api_key')
  if (!apiKey) {
    throw new Error('请先配置 Grok API Key')
  }

  const apiUrl = getSetting('grok_api_url') || 'https://api.x.ai/v1'
  const model = getSetting('analysis_model') || 'grok-4-fast'
  const prompt = getSetting('analysis_prompt') || ''
  const concurrency = parseInt(getSetting('analysis_concurrency') || '2') || 2
  const rpm = parseInt(getSetting('analysis_rpm') || '10') || 10
  const sliceCount = parseInt(getSetting('analysis_slices') || '4') || 4

  if (!prompt) {
    throw new Error('请先配置分析提示词')
  }

  isAnalyzing = true
  shouldStop = false

  const totalCount = getUnanalyzedPostsCount(secUid)
  const posts = getUnanalyzedPosts(secUid)

  let analyzedCount = 0
  let failedCount = 0

  sendProgress({
    status: 'running',
    currentPost: null,
    currentIndex: 0,
    totalPosts: totalCount,
    analyzedCount: 0,
    failedCount: 0,
    message: '正在初始化分析...'
  })

  const rateLimiter = new RateLimiter(rpm)

  try {
    const tasks = posts.map((post, index) => async () => {
      if (shouldStop) {
        throw new Error('已停止')
      }

      const postDesc = post.desc?.substring(0, 20) || post.aweme_id

      sendProgress({
        status: 'running',
        currentPost: postDesc,
        currentIndex: index + 1,
        totalPosts: totalCount,
        analyzedCount,
        failedCount,
        message: `正在分析: ${postDesc}...`
      })

      const result = await analyzePost(post, sliceCount, rateLimiter, apiKey, apiUrl, model, prompt)
      updatePostAnalysis(post.id, result)
      return result
    })

    await runWithConcurrency(tasks, concurrency, (index, result) => {
      if (result instanceof Error) {
        failedCount++
        console.error(`[Analyzer] Failed to analyze post ${posts[index].aweme_id}:`, result.message)
      } else {
        analyzedCount++
      }

      if ((analyzedCount + failedCount) % 5 === 0) {
        sendProgress({
          status: 'running',
          currentPost: posts[index].desc?.substring(0, 20) || posts[index].aweme_id,
          currentIndex: index + 1,
          totalPosts: totalCount,
          analyzedCount,
          failedCount,
          message: `已分析 ${analyzedCount} 个，失败 ${failedCount} 个`
        })
      }
    })

    sendProgress({
      status: shouldStop ? 'stopped' : 'completed',
      currentPost: null,
      currentIndex: totalCount,
      totalPosts: totalCount,
      analyzedCount,
      failedCount,
      message: shouldStop
        ? `已停止，共分析 ${analyzedCount} 个，失败 ${failedCount} 个`
        : `分析完成，共 ${analyzedCount} 个，失败 ${failedCount} 个`
    })
  } catch (error) {
    console.error('[Analyzer] Analysis failed:', error)
    sendProgress({
      status: 'failed',
      currentPost: null,
      currentIndex: 0,
      totalPosts: totalCount,
      analyzedCount,
      failedCount,
      message: `分析失败: ${(error as Error).message}`
    })
  } finally {
    isAnalyzing = false
    shouldStop = false
  }
}

export function stopAnalysis(): void {
  shouldStop = true
}

export function isAnalysisRunning(): boolean {
  return isAnalyzing
}
