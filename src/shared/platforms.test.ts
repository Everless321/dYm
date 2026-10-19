import { describe, expect, it } from 'vitest'
import {
  detectCreatorPlatform,
  extractCreatorLink,
  normalizeBilibiliCreatorSettings,
  sanitizeAddCreatorOptions
} from './platforms'

describe('detectCreatorPlatform', () => {
  it('识别抖音和哔哩哔哩链接', () => {
    expect(detectCreatorPlatform('https://v.douyin.com/abc/')).toBe('douyin')
    expect(detectCreatorPlatform('https://www.douyin.com/user/MS4w')).toBe('douyin')
    expect(detectCreatorPlatform('https://www.iesdouyin.com/share/video/1')).toBe('douyin')
    expect(detectCreatorPlatform('https://space.bilibili.com/12345')).toBe('bilibili')
    expect(detectCreatorPlatform('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('bilibili')
    expect(detectCreatorPlatform('https://b23.tv/abc')).toBe('bilibili')
    expect(detectCreatorPlatform('BV1xx411c7mD')).toBe('bilibili')
    expect(detectCreatorPlatform('uid:88')).toBe('bilibili')
    expect(detectCreatorPlatform('hello')).toBeNull()
  })

  it('从分享文案里抽出链接', () => {
    expect(
      extractCreatorLink('好看 https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333')
    ).toEqual({
      platform: 'bilibili',
      url: 'https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333'
    })
    expect(extractCreatorLink('没有链接')).toBeNull()
  })

  it('哔哩哔哩设置只保留合法档位', () => {
    expect(
      normalizeBilibiliCreatorSettings({
        videoQuality: 999,
        videoCodec: 'hevc',
        audioQuality: 30216,
        downloadDanmaku: true,
        downloadAllPages: true
      })
    ).toMatchObject({
      videoQuality: 0,
      videoCodec: 'hevc',
      audioQuality: 30216,
      downloadDanmaku: true,
      downloadSubtitle: false,
      downloadCover: true,
      downloadAllPages: true
    })
  })

  it('添加参数同时接受桌面端和管理端字段名', () => {
    expect(
      sanitizeAddCreatorOptions({
        maxDownloadCount: 12.9,
        showInHome: false,
        autoSync: true,
        syncCron: ' 0 8 * * * ',
        bilibili: { videoCodec: 'av1', downloadSubtitle: true }
      })
    ).toMatchObject({
      max_download_count: 12,
      show_in_home: false,
      auto_sync: true,
      sync_cron: '0 8 * * *',
      platform_settings: { videoCodec: 'av1', downloadSubtitle: true, videoQuality: 0 }
    })
  })
})
