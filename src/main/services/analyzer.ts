import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { rm, mkdir } from 'fs/promises'
import { randomUUID } from 'crypto'
import ffmpeg from 'fluent-ffmpeg'
import { ffmpegPath, ffprobePath } from '../utils/ffmpeg-path'
import {
  getSetting,
  getUnanalyzedPosts,
  getPostById,
  updatePostAnalysis,
  type DbPost,
  type AnalysisResult
} from '../database'

ffmpeg.setFfmpegPath(ffmpegPath)
ffmpeg.setFfprobePath(ffprobePath)

// FFmpeg 并发限制（避免同时运行太多 ffmpeg 进程）
const MAX_FFMPEG_CONCURRENCY = 2
let ffmpegRunning = 0
const ffmpegQueue: Array<() => void> = []

async function acquireFfmpegSlot(): Promise<void> {
  if (ffmpegRunning < MAX_FFMPEG_CONCURRENCY) {
    ffmpegRunning++
    return
  }
  return new Promise((resolve) => {
    ffmpegQueue.push(() => {
      ffmpegRunning++
      resolve()
    })
  })
}

function releaseFfmpegSlot(): void {
  ffmpegRunning--
  const next = ffmpegQueue.shift()
  if (next) next()
}

export interface AnalysisProgress {
  status: 'running' | 'completed' | 'failed' | 'stopped'
  currentPost: string | null
  currentIndex: number
  totalPosts: number
  analyzedCount: number
  failedCount: number
  message: string
  // 单条完成结果，供重新标记进度页逐视频展示 + 失败重试
  lastResult?: { postId: number; ok: boolean; title: string }
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
  const customPath = getSetting('download_path')
  if (customPath && customPath.trim()) {
    return customPath
  }
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

// 使用 -ss 快速定位提取单帧（比 select 滤镜快很多）
async function extractSingleFrame(
  videoPath: string,
  timestamp: number,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .inputOptions([
        '-ss',
        timestamp.toFixed(2) // 在输入前 seek，利用关键帧快速定位
      ])
      .outputOptions([
        '-frames:v',
        '1', // 只提取一帧
        '-q:v',
        '2', // 最高质量
        '-y'
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run()
  })
}

async function extractVideoFrames(videoPath: string, sliceCount: number): Promise<string[]> {
  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`)
  }

  const tempDir = join(app.getPath('temp'), 'dym-frames', randomUUID())
  await mkdir(tempDir, { recursive: true })

  console.log(`[Analyzer] Extracting frames from: ${videoPath}`)

  // 获取 ffmpeg 执行槽位
  await acquireFfmpegSlot()

  try {
    const duration = await getVideoDuration(videoPath)
    console.log(`[Analyzer] Video duration: ${duration}s, slices: ${sliceCount}`)

    const interval = duration / (sliceCount + 1)
    const frames: string[] = []

    // 串行提取每一帧（使用 -ss 快速定位，比并行更省资源）
    for (let i = 1; i <= sliceCount; i++) {
      const timestamp = interval * i
      const framePath = join(tempDir, `frame_${i}.jpg`)

      try {
        await extractSingleFrame(videoPath, timestamp, framePath)
        if (existsSync(framePath)) {
          frames.push(framePath)
        }
      } catch (err) {
        console.warn(`[Analyzer] Failed to extract frame at ${timestamp}s:`, err)
      }
    }

    if (frames.length === 0) {
      throw new Error('No frames could be extracted from video')
    }

    console.log(`[Analyzer] Extracted ${frames.length} frames using seek`)
    return frames
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    throw error
  } finally {
    releaseFfmpegSlot()
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

// 兼容两种响应：普通 JSON 与 SSE 流（data: {...} 多行）。
// 部分 API 网关即使未请求 stream 也会返回 text/event-stream。
function extractMessageContent(rawBody: string): string {
  const trimmed = rawBody.trim()

  // 非 SSE：直接当 JSON 解析
  if (!trimmed.startsWith('data:')) {
    const data = JSON.parse(trimmed)
    return data.choices?.[0]?.message?.content ?? ''
  }

  // SSE：逐行拼接 delta.content（兼容个别 chunk 直接给 message.content）
  let content = ''
  for (const line of trimmed.split('\n')) {
    const text = line.trim()
    if (!text.startsWith('data:')) continue
    const payload = text.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const chunk = JSON.parse(payload)
      const choice = chunk.choices?.[0]
      content += choice?.delta?.content ?? choice?.message?.content ?? ''
    } catch {
      // 跳过不完整/非 JSON 的 chunk
    }
  }
  return content
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

  const rawBody = await response.text()
  const content = extractMessageContent(rawBody)

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
    content_level: typeof result.content_level === 'number' ? result.content_level : 0
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

interface AnalysisConfig {
  apiKey: string
  apiUrl: string
  model: string
  prompt: string
  concurrency: number
  rpm: number
  sliceCount: number
}

function loadAnalysisConfig(): AnalysisConfig {
  const apiKey = getSetting('grok_api_key')
  if (!apiKey) {
    throw new Error('请先配置 Grok API Key')
  }
  const prompt = getSetting('analysis_prompt') || ''
  if (!prompt) {
    throw new Error('请先配置分析提示词')
  }
  return {
    apiKey,
    apiUrl: getSetting('grok_api_url') || 'https://api.x.ai/v1',
    model: getSetting('analysis_model') || 'grok-4-fast',
    prompt,
    concurrency: parseInt(getSetting('analysis_concurrency') || '2') || 2,
    rpm: parseInt(getSetting('analysis_rpm') || '10') || 10,
    sliceCount: parseInt(getSetting('analysis_slices') || '4') || 4
  }
}

const postTitleOf = (post: DbPost): string =>
  (post.desc || post.caption || '').substring(0, 30) || `${post.nickname || '未知用户'}的视频`

// 分析指定的一批 posts（被 startAnalysis / reanalyze* 共用）
async function runAnalysisForPosts(posts: DbPost[]): Promise<void> {
  if (isAnalyzing) {
    throw new Error('分析任务正在进行中')
  }
  const config = loadAnalysisConfig()

  isAnalyzing = true
  shouldStop = false

  const totalCount = posts.length
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

  const rateLimiter = new RateLimiter(config.rpm)

  try {
    const tasks = posts.map((post, index) => async () => {
      if (shouldStop) {
        throw new Error('已停止')
      }

      sendProgress({
        status: 'running',
        currentPost: postTitleOf(post),
        currentIndex: index + 1,
        totalPosts: totalCount,
        analyzedCount,
        failedCount,
        message: postTitleOf(post)
      })

      const result = await analyzePost(
        post,
        config.sliceCount,
        rateLimiter,
        config.apiKey,
        config.apiUrl,
        config.model,
        config.prompt
      )
      updatePostAnalysis(post.id, result)
      return result
    })

    await runWithConcurrency(tasks, config.concurrency, (index, result) => {
      const post = posts[index]
      const ok = !(result instanceof Error)
      if (ok) {
        analyzedCount++
      } else {
        failedCount++
        console.error(
          `[Analyzer] Failed to analyze post ${post.aweme_id}:`,
          (result as Error).message
        )
      }

      sendProgress({
        status: 'running',
        currentPost: postTitleOf(post),
        currentIndex: index + 1,
        totalPosts: totalCount,
        analyzedCount,
        failedCount,
        message: `已分析 ${analyzedCount} 个，失败 ${failedCount} 个`,
        lastResult: { postId: post.id, ok, title: postTitleOf(post) }
      })
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

export async function startAnalysis(secUid?: string): Promise<void> {
  await runAnalysisForPosts(getUnanalyzedPosts(secUid))
}

// 重新分析单个视频（覆盖 AI 标签，不影响手动标签）
export async function reanalyzePost(postId: number): Promise<void> {
  const post = getPostById(postId)
  if (!post) {
    throw new Error('视频不存在')
  }
  await runAnalysisForPosts([post])
}

// 重新分析指定的多个视频
export async function reanalyzePosts(postIds: number[]): Promise<void> {
  const posts = postIds.map((id) => getPostById(id)).filter((p): p is DbPost => !!p)
  if (!posts.length) {
    throw new Error('没有可重新分析的视频')
  }
  await runAnalysisForPosts(posts)
}

export function stopAnalysis(): void {
  shouldStop = true
}

export function isAnalysisRunning(): boolean {
  return isAnalyzing
}
