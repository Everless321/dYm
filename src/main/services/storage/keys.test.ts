import { describe, expect, it } from 'vitest'
import {
  contentTypeFor,
  localFileNameFor,
  parseObjectKey,
  planPostObjects,
  postKeyPrefix
} from './keys'

const SEC = 'MS4wLjABAAAAtest'
const ID = '7552967815993576746'
const base = `creators/${SEC}/posts/${ID}`

function keysOf(files: string[]): string[] {
  return planPostObjects(files, SEC, ID).map((o) => o.key)
}

describe('planPostObjects', () => {
  it('视频作品：封面、正片、原声', () => {
    const plan = planPostObjects(
      [`${ID}_cover.webp`, `${ID}_video.mp4`, `${ID}_music.mp3`, `${ID}_desc.txt`],
      SEC,
      ID
    )
    expect(plan).toEqual([
      {
        file: `${ID}_cover.webp`,
        key: `${base}/cover.jpg`,
        kind: 'cover',
        idx: 0,
        contentType: 'image/webp'
      },
      {
        file: `${ID}_video.mp4`,
        key: `${base}/video.mp4`,
        kind: 'video',
        idx: 0,
        contentType: 'video/mp4'
      },
      {
        file: `${ID}_music.mp3`,
        key: `${base}/music.mp3`,
        kind: 'music',
        idx: 0,
        contentType: 'audio/mpeg'
      }
    ])
  })

  it('图片按序号而不是字典序排，_image_10 在 _image_2 之后', () => {
    const files = [1, 10, 2, 3].map((n) => `${ID}_image_${n}.webp`)
    const plan = planPostObjects(files, SEC, ID)
    expect(plan.map((o) => [o.file, o.key])).toEqual([
      [`${ID}_image_1.webp`, `${base}/images/0.jpg`],
      [`${ID}_image_2.webp`, `${base}/images/1.jpg`],
      [`${ID}_image_3.webp`, `${base}/images/2.jpg`],
      [`${ID}_image_10.webp`, `${base}/images/3.jpg`]
    ])
  })

  it('实况 _live_N 对齐到第 N 张图，没有实况的位置跳过', () => {
    const files = [
      `${ID}_image_1.jpg`,
      `${ID}_image_2.jpg`,
      `${ID}_image_3.jpg`,
      `${ID}_live_1.mp4`,
      `${ID}_live_3.mp4`
    ]
    const lives = planPostObjects(files, SEC, ID).filter((o) => o.kind === 'live')
    expect(lives.map((o) => [o.file, o.key, o.idx])).toEqual([
      [`${ID}_live_1.mp4`, `${base}/live/0.mp4`, 0],
      [`${ID}_live_3.mp4`, `${base}/live/2.mp4`, 2]
    ])
  })

  it('实况下标超出图片数时仍按下标落位（与 upload.py 的 slots 取最大值一致）', () => {
    const files = [`${ID}_image_1.jpg`, `${ID}_live_4.mp4`]
    expect(keysOf(files)).toContain(`${base}/live/3.mp4`)
  })

  it('实况 mp4 不会被当成正片', () => {
    expect(keysOf([`${ID}_image_1.jpg`, `${ID}_live_1.mp4`])).not.toContain(`${base}/video.mp4`)
  })

  it('上传顺序与 upload.py 一致：封面、正片、图片、实况、原声', () => {
    const files = [`${ID}_music.m4a`, `${ID}_live_1.mp4`, `${ID}_image_1.jpg`, `${ID}_cover.jpeg`]
    expect(planPostObjects(files, SEC, ID).map((o) => o.kind)).toEqual([
      'cover',
      'image',
      'live',
      'music'
    ])
  })

  it('原声无论扩展名都落到 music.mp3，Content-Type 按真实扩展名', () => {
    const [music] = planPostObjects([`${ID}_music.m4a`], SEC, ID)
    expect(music.key).toBe(`${base}/music.mp3`)
    expect(music.contentType).toBe('audio/mp4')
  })

  it('没有可上传文件时返回空数组', () => {
    expect(planPostObjects([`${ID}_desc.txt`, 'foo.tmp'], SEC, ID)).toEqual([])
  })
})

describe('postKeyPrefix', () => {
  it('以斜杠结尾，避免 id 前缀相同的作品互相匹配', () => {
    expect(postKeyPrefix(SEC, ID)).toBe(`${base}/`)
  })
})

describe('contentTypeFor', () => {
  it.each([
    ['a.MP4', 'video/mp4'],
    ['a.jpeg', 'image/jpeg'],
    ['a.png', 'image/png'],
    ['a.aac', 'application/octet-stream']
  ])('%s → %s', (name, type) => {
    expect(contentTypeFor(name)).toBe(type)
  })
})

describe('parseObjectKey', () => {
  it.each([
    ['cover.jpg', { kind: 'cover', idx: 0 }],
    ['video.mp4', { kind: 'video', idx: 0 }],
    ['music.mp3', { kind: 'music', idx: 0 }],
    ['images/0.jpg', { kind: 'image', idx: 0 }],
    ['images/12.jpg', { kind: 'image', idx: 12 }],
    ['live/3.mp4', { kind: 'live', idx: 3 }]
  ])('%s', (rest, expected) => {
    expect(parseObjectKey(`${base}/${rest}`)).toEqual(expected)
  })

  it('不认识的 key 返回 null（不会被当成作品文件）', () => {
    expect(parseObjectKey(`${base}/desc.txt`)).toBeNull()
    expect(parseObjectKey(`${base}/images/x.jpg`)).toBeNull()
    expect(parseObjectKey(`creators/${SEC}/avatar.jpg`)).toBeNull()
  })

  it('与 planPostObjects 互逆', () => {
    const files = [`${ID}_cover.jpg`, `${ID}_image_1.jpg`, `${ID}_image_2.jpg`, `${ID}_live_2.mp4`]
    for (const o of planPostObjects(files, SEC, ID)) {
      expect(parseObjectKey(o.key)).toEqual({ kind: o.kind, idx: o.idx })
    }
  })
})

describe('localFileNameFor', () => {
  it('缓存里的文件名能被 planPostObjects 认回同一个 key（缓存目录可直接当作品目录用）', () => {
    const objects = [
      { key: `${base}/cover.jpg`, kind: 'cover', idx: 0, content_type: 'image/webp' },
      { key: `${base}/video.mp4`, kind: 'video', idx: 0, content_type: 'video/mp4' },
      { key: `${base}/images/0.jpg`, kind: 'image', idx: 0, content_type: null },
      { key: `${base}/images/10.jpg`, kind: 'image', idx: 10, content_type: 'image/png' },
      { key: `${base}/live/10.mp4`, kind: 'live', idx: 10, content_type: 'video/mp4' },
      { key: `${base}/music.mp3`, kind: 'music', idx: 0, content_type: 'audio/mp4' }
    ] as const
    const names = objects.map((o) => localFileNameFor(ID, o.kind, o.idx, o.content_type))
    expect(names).toEqual([
      `${ID}_cover.webp`,
      `${ID}_video.mp4`,
      `${ID}_image_1.jpg`,
      `${ID}_image_11.png`,
      `${ID}_live_11.mp4`,
      `${ID}_music.m4a`
    ])
    // images/0 与 images/10 之间没有其他图片，重新规划会把下标压紧，这里只校验能认回的类别和相对顺序
    const replanned = planPostObjects(names, SEC, ID)
    expect(replanned.map((o) => o.kind)).toEqual([
      'cover',
      'video',
      'image',
      'image',
      'live',
      'music'
    ])
  })
})
