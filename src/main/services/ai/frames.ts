import { join } from 'path'
import { existsSync, readdirSync } from 'fs'
import { copyFile, readFile } from 'fs/promises'
import { getDownloadPath } from '../media'
import type { VisionImage } from './types'
import type { AnalysisWindow } from './plan'
import { makeTempDir, removeTempDir, runFfmpeg } from './ffmpeg'

/**
 * 画面抽取：场景切换检测挑候选帧，不够再均匀补，多了均匀抽稀；长视频可拼成一张九宫格省 token。
 */

export interface FrameSet {
  images: VisionImage[]
  /** 每张图对应的绝对秒；拼图模式下是格子顺序对应的时间 */
  times: number[]
  mosaic: boolean
}

export function findMediaFolder(secUid: string, folderName: string): string | null {
  const basePath = join(getDownloadPath(), secUid)
  if (!existsSync(basePath)) return null
  const exactPath = join(basePath, folderName)
  if (existsSync(exactPath)) return exactPath
  try {
    for (const folder of readdirSync(basePath)) {
      if (folder.endsWith(folderName) || folder.includes(`_${folderName}`)) {
        return join(basePath, folder)
      }
    }
  } catch {
    return null
  }
  return null
}

export function findVideoFile(post: { sec_uid: string; folder_name: string }): string {
  const mediaFolder = findMediaFolder(post.sec_uid, post.folder_name)
  if (!mediaFolder) throw new Error('本地媒体目录不存在（可能已被删除或迁移）')
  const videoFile = readdirSync(mediaFolder).find((f) => /\.(mp4|mov|avi|mkv|flv)$/i.test(f))
  if (!videoFile) throw new Error('目录里没有视频文件')
  return join(mediaFolder, videoFile)
}

function mimeOf(file: string): VisionImage['mime'] {
  const ext = file.split('.').pop()?.toLowerCase()
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
}

/** 图集：取前 N 张图 */
export async function loadGalleryImages(
  post: { sec_uid: string; folder_name: string },
  maxImages: number
): Promise<VisionImage[]> {
  const mediaFolder = findMediaFolder(post.sec_uid, post.folder_name)
  if (!mediaFolder) throw new Error('本地媒体目录不存在（可能已被删除或迁移）')
  const imageFiles = readdirSync(mediaFolder)
    .filter((f) => /\.(webp|jpg|jpeg|png)$/i.test(f) && !f.includes('_cover'))
    .sort()
    .slice(0, Math.max(1, Math.min(20, maxImages)))
  if (!imageFiles.length) throw new Error('图集目录里没有图片文件')
  const images: VisionImage[] = []
  for (const file of imageFiles) {
    images.push({ mime: mimeOf(file), data: await readFile(join(mediaFolder, file)) })
  }
  return images
}

/** 场景切换阈值：0.3 对短视频的镜头切换够敏感，又不会把摇镜头当成切换 */
const SCENE_THRESHOLD = 0.3
/** 两帧时间差小于此值视为同一画面 */
const MIN_GAP_SECONDS = 1.5

/**
 * 第一遍：只解码关键帧跑场景检测，输出候选帧及其（相对窗口起点的）时间。
 * 只解关键帧比全解码快一个量级，长视频十几个窗口也扛得住；镜头切换绝大多数正好落在关键帧上。
 */
async function sceneCandidates(
  videoPath: string,
  window: AnalysisWindow,
  dir: string,
  width: number,
  signal: AbortSignal
): Promise<{ file: string; time: number }[]> {
  const duration = window.end - window.start
  let stderr = ''
  try {
    const result = await runFfmpeg(
      [
        '-loglevel',
        'info',
        '-skip_frame',
        'nokey',
        '-ss',
        window.start.toFixed(3),
        '-t',
        duration.toFixed(3),
        '-i',
        videoPath,
        '-vf',
        `select='gt(scene,${SCENE_THRESHOLD})',showinfo,scale='min(${width},iw)':-2`,
        '-fps_mode',
        'vfr',
        '-frames:v',
        '60',
        '-q:v',
        '3',
        join(dir, 'scene-%03d.jpg')
      ],
      { timeoutMs: 180_000, signal }
    )
    stderr = result.stderr
  } catch (error) {
    if (signal.aborted) throw error
    console.warn('[AI] 场景检测失败，改用均匀抽帧:', (error as Error).message)
    return []
  }
  const times: number[] = []
  for (const match of stderr.matchAll(
    /\[Parsed_showinfo[^\]]*\]\s*n:\s*\d+.*?pts_time:\s*([\d.]+)/g
  )) {
    times.push(parseFloat(match[1]))
  }
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('scene-'))
    .sort()
  return files.map((file, i) => ({ file: join(dir, file), time: times[i] ?? i }))
}

/** 第二遍：在指定的（相对）时间点各抽一帧，一个进程多路输入 */
async function framesAt(
  videoPath: string,
  window: AnalysisWindow,
  relTimes: number[],
  dir: string,
  width: number,
  signal: AbortSignal
): Promise<{ file: string; time: number }[]> {
  if (!relTimes.length) return []
  const args: string[] = ['-loglevel', 'error']
  relTimes.forEach((t) => {
    args.push('-threads', '2', '-ss', (window.start + t).toFixed(3), '-i', videoPath)
  })
  const outputs = relTimes.map((t, i) => ({ file: join(dir, `uniform-${i}.jpg`), time: t }))
  outputs.forEach((o, i) => {
    args.push(
      '-map',
      `${i}:v:0`,
      '-frames:v',
      '1',
      '-vf',
      `scale='min(${width},iw)':-2`,
      '-q:v',
      '3',
      o.file
    )
  })
  try {
    await runFfmpeg(args, { timeoutMs: 120_000, signal })
  } catch (error) {
    if (signal.aborted) throw error
    console.warn('[AI] 均匀抽帧报错（若仍有帧产出则继续）:', (error as Error).message)
  }
  return outputs.filter((o) => existsSync(o.file))
}

/** 从 n 个里均匀挑 k 个下标 */
function pickEvenly<T>(items: T[], k: number): T[] {
  if (items.length <= k) return items
  const out: T[] = []
  for (let i = 0; i < k; i++) out.push(items[Math.round((i * (items.length - 1)) / (k - 1 || 1))])
  return out
}

async function mosaicOf(
  frames: { file: string; time: number }[],
  dir: string,
  signal: AbortSignal
): Promise<VisionImage> {
  // image2 序列输入要求连续编号
  for (let i = 0; i < frames.length; i++) {
    await copyFile(frames[i].file, join(dir, `pick-${String(i).padStart(3, '0')}.jpg`))
  }
  const cols = Math.ceil(Math.sqrt(frames.length))
  const rows = Math.ceil(frames.length / cols)
  const out = join(dir, 'mosaic.jpg')
  await runFfmpeg(
    [
      '-loglevel',
      'error',
      '-framerate',
      '1',
      '-i',
      join(dir, 'pick-%03d.jpg'),
      '-vf',
      `scale=512:288:force_original_aspect_ratio=decrease,pad=512:288:(ow-iw)/2:(oh-ih)/2:black,tile=${cols}x${rows}:padding=4:color=black`,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      out
    ],
    { timeoutMs: 60_000, signal }
  )
  return { mime: 'image/jpeg', data: await readFile(out) }
}

export async function extractWindowFrames(
  videoPath: string,
  window: AnalysisWindow,
  options: { maxFrames: number; mosaic: boolean; signal: AbortSignal }
): Promise<FrameSet> {
  const duration = window.end - window.start
  const budget = Math.max(1, options.maxFrames)
  // 拼图里每格只有 512 宽，源帧不必太大；单帧送模型缩到 1280 以内
  const width = options.mosaic ? 640 : duration <= 60 ? 1280 : 960
  const dir = await makeTempDir(`frames-${window.index}`)
  try {
    let picked = await sceneCandidates(videoPath, window, dir, width, options.signal)
    // 相邻太近的候选当同一画面
    picked = picked.filter((f, i) => i === 0 || f.time - picked[i - 1].time >= MIN_GAP_SECONDS)
    if (picked.length > budget) picked = pickEvenly(picked, budget)

    if (picked.length < budget) {
      // 候选不够：在没覆盖到的位置均匀补帧
      const want = budget - picked.length
      const interval = duration / (want + 1)
      const relTimes: number[] = []
      for (let i = 1; i <= want; i++) {
        const t = interval * i
        if (picked.every((p) => Math.abs(p.time - t) >= MIN_GAP_SECONDS)) relTimes.push(t)
      }
      picked.push(...(await framesAt(videoPath, window, relTimes, dir, width, options.signal)))
      picked.sort((a, b) => a.time - b.time)
    }
    if (!picked.length) throw new Error('未能从视频中提取任何画面')

    const times = picked.map((p) => Math.round((window.start + p.time) * 10) / 10)
    if (options.mosaic && picked.length > 1) {
      return { images: [await mosaicOf(picked, dir, options.signal)], times, mosaic: true }
    }
    const images: VisionImage[] = []
    for (const p of picked) images.push({ mime: 'image/jpeg', data: await readFile(p.file) })
    return { images, times, mosaic: false }
  } finally {
    await removeTempDir(dir)
  }
}
