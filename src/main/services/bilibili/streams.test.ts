import { describe, expect, it } from 'vitest'
import { pickAudioStream, pickVideoStream } from './streams'

const videos = [
  { id: 80, codecid: 7, baseUrl: 'https://cdn/avc80' },
  { id: 120, codecid: 7, baseUrl: 'https://cdn/avc120' },
  { id: 80, codecid: 12, baseUrl: 'https://cdn/hevc80' },
  { id: 64, codecid: 13, baseUrl: 'https://cdn/av1-64' }
]

describe('pickVideoStream', () => {
  it('同一编码里取不超过目标的最高画质', () => {
    expect(pickVideoStream(videos, 80, 'avc')?.baseUrl).toBe('https://cdn/avc80')
    expect(pickVideoStream(videos, 112, 'avc')?.baseUrl).toBe('https://cdn/avc80')
  })

  it('没有目标编码时退回其他编码', () => {
    expect(pickVideoStream(videos, 80, 'av1')?.baseUrl).toBe('https://cdn/av1-64')
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
})
