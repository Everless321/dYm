import { dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { createWriteStream } from 'fs'
import { mkdir } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { getSetting } from '../database'
import { fetchVideoDetail } from '../services/douyin'
import { convertFolderImagesToJpg } from '../services/downloader'

export function registerVideoIpc(): void {
  // Video IPC handlers
  ipcMain.handle('video:getDetail', async (_event, url: string) => {
    const detail = (await fetchVideoDetail(url)) as {
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
      awemeId: detail.awemeId || '',
      desc: detail.desc || '',
      nickname: detail.nickname || '',
      coverUrl,
      type: isImages ? 'images' : 'video',
      videoUrl: isImages ? undefined : detail.videoPlayAddr?.[0] || '',
      imageUrls: isImages ? detail.images || [] : undefined
    }
  })

  ipcMain.handle(
    'video:downloadToFolder',
    async (
      _event,
      info: {
        awemeId: string
        desc: string
        nickname: string
        type: 'video' | 'images'
        videoUrl?: string
        imageUrls?: string[]
      }
    ) => {
      const result = await dialog.showOpenDialog({
        title: '选择保存目录',
        properties: ['openDirectory', 'createDirectory']
      })

      if (result.canceled || !result.filePaths[0]) {
        throw new Error('已取消')
      }

      const savePath = result.filePaths[0]
      const folderName = `${info.nickname}_${info.awemeId}`
      const folderPath = join(savePath, folderName)

      await mkdir(folderPath, { recursive: true })

      const cookie = getSetting('douyin_cookie') || ''
      const headers = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://www.douyin.com/',
        Cookie: cookie
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

      // 图文作品转 JPG
      if (info.type === 'images' && getSetting('convert_images_to_jpg') === 'true') {
        await convertFolderImagesToJpg(folderPath)
      }

      shell.openPath(folderPath)
    }
  )
}
