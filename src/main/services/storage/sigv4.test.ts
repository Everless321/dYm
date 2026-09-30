import { describe, expect, it } from 'vitest'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { alignedSigningWindow, presignUrl, type S3Target } from './sigv4'

const target: S3Target = {
  endpoint: 'https://abc123.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'trove-media',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY'
}

const client = new S3Client({
  endpoint: target.endpoint,
  region: target.region,
  forcePathStyle: true,
  credentials: { accessKeyId: target.accessKeyId, secretAccessKey: target.secretAccessKey },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED'
})

const date = new Date('2026-09-29T07:00:00Z')
const sign = (command: unknown): Promise<string> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSignedUrl(client, command as any, { expiresIn: 7200, signingDate: date })

const AUTH_PARAMS = new Set([
  'X-Amz-Algorithm',
  'X-Amz-Credential',
  'X-Amz-Date',
  'X-Amz-Expires',
  'X-Amz-SignedHeaders',
  'X-Amz-Signature'
])

/** 拿 SDK 的结果当标准答案：把 SDK 额外加的查询参数（如 x-id）喂给我们的签名器，比对完整 URL */
async function expectSameAsSdk(
  signed: Promise<string>,
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
  key: string | null
): Promise<void> {
  const sdk = new URL(await signed)
  const extra = Object.fromEntries([...sdk.searchParams].filter(([k]) => !AUTH_PARAMS.has(k)))
  const ours = new URL(presignUrl(target, { method, key, query: extra, date, expiresIn: 7200 }))

  expect(ours.origin + ours.pathname).toBe(sdk.origin + sdk.pathname)
  expect(Object.fromEntries(ours.searchParams)).toEqual(Object.fromEntries(sdk.searchParams))
}

describe('presignUrl 与 AWS SDK 签名一致', () => {
  const Bucket = target.bucket

  it('GetObject', async () => {
    const Key = 'creators/MS4w/posts/123/cover.jpg'
    await expectSameAsSdk(sign(new GetObjectCommand({ Bucket, Key })), 'GET', Key)
  })

  it('PutObject', async () => {
    const Key = 'creators/MS4w/posts/123/video.mp4'
    await expectSameAsSdk(sign(new PutObjectCommand({ Bucket, Key })), 'PUT', Key)
  })

  it('HeadObject', async () => {
    const Key = 'creators/MS4w/posts/123/images/0.jpg'
    await expectSameAsSdk(sign(new HeadObjectCommand({ Bucket, Key })), 'HEAD', Key)
  })

  it('DeleteObject', async () => {
    const Key = 'creators/MS4w/posts/123/music.mp3'
    await expectSameAsSdk(sign(new DeleteObjectCommand({ Bucket, Key })), 'DELETE', Key)
  })

  it('key 里有需要转义的字符（sec_uid 带 - 和 _，文件名带空格与中文）', async () => {
    const Key = 'creators/MS4w-AB_c/posts/1/a b+中文(1).jpg'
    await expectSameAsSdk(sign(new GetObjectCommand({ Bucket, Key })), 'GET', Key)
  })

  it('ListObjectsV2（查询参数参与签名）', async () => {
    const command = new ListObjectsV2Command({
      Bucket,
      Prefix: 'creators/MS4w/posts/',
      MaxKeys: 1000,
      ContinuationToken: '1/abc+def=='
    })
    await expectSameAsSdk(sign(command), 'GET', null)
  })
})

describe('alignedSigningWindow', () => {
  it('同一个小时内签出的 URL 逐字符相同，浏览器缓存才有得命中', () => {
    const key = 'creators/MS4w/posts/1/cover.jpg'
    const a = alignedSigningWindow(new Date('2026-09-29T07:05:00Z'))
    const b = alignedSigningWindow(new Date('2026-09-29T07:59:59Z'))
    expect(presignUrl(target, { method: 'GET', key, ...a })).toBe(
      presignUrl(target, { method: 'GET', key, ...b })
    )
  })

  it('有效期至少还剩 1 小时', () => {
    const now = new Date('2026-09-29T07:59:59Z')
    const { date: start, expiresIn } = alignedSigningWindow(now)
    expect(start.getTime() + expiresIn * 1000 - now.getTime()).toBeGreaterThanOrEqual(3600_000)
  })
})
