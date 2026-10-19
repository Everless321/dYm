import { describe, expect, it } from 'vitest'
import { audioOnlyExtension, pickAudioStream, pickVideoStream } from './streams'

const videos = [
  { id: 80, codecid: 7, baseUrl: 'https://cdn/avc80' },
  { id: 120, codecid: 7, baseUrl: 'https://cdn/avc120' },
  { id: 80, codecid: 12, baseUrl: 'https://cdn/hevc80' },
  { id: 64, codecid: 13, baseUrl: 'https://cdn/av1-64' }
]

describe('pickVideoStream', () => {
  it('取不超过目标的最高画质', () => {
    expect(pickVideoStream(videos, 80, 'avc')?.baseUrl).toBe('https://cdn/avc80')
    expect(pickVideoStream(videos, 112, 'avc')?.baseUrl).toBe('https://cdn/avc80')
  })

  it('0 表示取最高可用画质', () => {
    expect(pickVideoStream(videos, 0, 'hevc')?.baseUrl).toBe('https://cdn/avc120')
  })

  it('同一档画质里优先偏好编码', () => {
    expect(pickVideoStream(videos, 80, 'hevc')?.baseUrl).toBe('https://cdn/hevc80')
  })

  it('偏好编码画质更低时不降档，改用同档的其他编码', () => {
    const picked = pickVideoStream(videos, 80, 'av1')
    expect(picked?.id).toBe(80)
    expect(picked?.codecid).not.toBe(13)
  })

  it('没有不超过目标的档位时取最低一档', () => {
    expect(pickVideoStream(videos, 32, 'avc')?.baseUrl).toBe('https://cdn/av1-64')
  })
})

describe('pickAudioStream', () => {
  it('优先 Hi-Res，缺失时退回普通音轨', () => {
    const flac = pickAudioStream(
      {
        audio: [{ id: 30280, baseUrl: 'https://cdn/192' }],
        flac: { audio: { id: 30250, baseUrl: 'https://cdn/flac' } }
      },
      30250
    )
    expect(flac?.baseUrl).toBe('https://cdn/flac')

    const fallback = pickAudioStream(
      {
        audio: [
          { id: 30232, baseUrl: 'https://cdn/132' },
          { id: 30280, baseUrl: 'https://cdn/192' }
        ]
      },
      30250
    )
    expect(fallback?.baseUrl).toBe('https://cdn/192')
  })

  it('0 表示最高可用：有 Hi-Res 取 Hi-Res，不自动取杜比', () => {
    const dolby = { id: 30251, baseUrl: 'https://cdn/dolby' }
    const flac = { id: 30250, baseUrl: 'https://cdn/flac' }
    const regular = [
      { id: 30232, baseUrl: 'https://cdn/132' },
      { id: 30280, baseUrl: 'https://cdn/192' }
    ]
    expect(pickAudioStream({ audio: regular, flac: { audio: flac } }, 0)?.baseUrl).toBe(
      'https://cdn/flac'
    )
    expect(pickAudioStream({ audio: regular, dolby: { audio: [dolby] } }, 0)?.baseUrl).toBe(
      'https://cdn/192'
    )
  })
})

describe('audioOnlyExtension', () => {
  it('按音轨来源选容器', () => {
    const regular = { id: 30280, baseUrl: 'https://cdn/192' }
    const flac = { id: 30250, baseUrl: 'https://cdn/flac' }
    const dolby = { id: 30251, baseUrl: 'https://cdn/dolby' }
    const dash = { audio: [regular], flac: { audio: flac }, dolby: { audio: [dolby] } }
    expect(audioOnlyExtension(dash, regular)).toBe('m4a')
    expect(audioOnlyExtension(dash, flac)).toBe('flac')
    expect(audioOnlyExtension(dash, dolby)).toBe('mp4')
  })
})
