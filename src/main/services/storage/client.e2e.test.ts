/**
 * 对真实 S3 兼容存储的端到端测试。默认跳过；指定凭据文件才跑：
 *
 *   STORAGE_E2E_ENV=/path/to/r2.env npx vitest run src/main/services/storage/client.e2e.test.ts
 *
 * r2.env 格式：R2_ENDPOINT= / R2_ACCESS_KEY_ID= / R2_SECRET_ACCESS_KEY= / R2_BUCKET=
 * 可选 STORAGE_E2E_RELAY_URL / STORAGE_E2E_RELAY_TOKEN：经上传中转写入。
 * 只写 _dym-selftest/ 前缀，结束时删除。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { randomBytes } from 'crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createObjectStore,
  deleteObject,
  headObject,
  listObjects,
  remoteObjectUrl,
  testStorageConnection
} from './client'
import type { StorageConfig } from './config'
import { syncPostObjects, type LocalObject } from './sync-post'

const envFile = process.env.STORAGE_E2E_ENV

function loadConfig(path: string): StorageConfig {
  const env = Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => {
        const i = l.indexOf('=')
        return [
          l.slice(0, i).trim(),
          l
            .slice(i + 1)
            .trim()
            .replace(/^["']|["']$/g, '')
        ]
      })
  )
  return {
    enabled: true,
    target: {
      endpoint: env.R2_ENDPOINT,
      region: 'auto',
      bucket: env.R2_BUCKET,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY
    },
    publicBaseUrl: '',
    // 可选：STORAGE_E2E_RELAY_URL / STORAGE_E2E_RELAY_TOKEN 给了就经中转上传
    relay: process.env.STORAGE_E2E_RELAY_URL
      ? {
          url: process.env.STORAGE_E2E_RELAY_URL,
          token: process.env.STORAGE_E2E_RELAY_TOKEN ?? ''
        }
      : null,
    concurrency: 1,
    localPolicy: 'keep',
    graceDays: 0,
    cacheBytes: 0
  }
}

describe.skipIf(!envFile)('对象存储端到端', () => {
  const config = envFile ? loadConfig(envFile) : (null as unknown as StorageConfig)
  const dir = mkdtempSync(join(tmpdir(), 'dym-storage-e2e-'))
  const prefix = `_dym-selftest/${Date.now()}`
  const body = randomBytes(3 * 1024 * 1024 + 17)
  const path = join(dir, 'video.mp4')
  writeFileSync(path, body)
  const obj: LocalObject = {
    key: `${prefix}/posts/1/video.mp4`,
    kind: 'video',
    idx: 0,
    contentType: 'video/mp4',
    path,
    size: body.length
  }

  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true })
    // 用我们自己的 deleteObject 清理，顺带验证它；删不存在的对象也应成功（幂等）
    await deleteObject(config, obj.key)
    await deleteObject(config, obj.key)
    expect(await headObject(config, obj.key)).toBeNull()
  })

  it('测试连接成功', async () => {
    expect(await testStorageConnection(config)).toMatchObject({ ok: true })
  })

  it('不存在的对象 HEAD 返回 null', async () => {
    expect(await headObject(config, `${prefix}/nope`)).toBeNull()
  })

  it('上传后 HEAD 大小一致，第二次同步直接认领不重传', async () => {
    const store = createObjectStore(config)
    const first = await syncPostObjects([obj], store)
    expect(first[0].size).toBe(body.length)

    let puts = 0
    const counting = { ...store, put: (o: LocalObject, a: number) => (puts++, store.put(o, a)) }
    await syncPostObjects([obj], counting)
    expect(puts).toBe(0)
  }, 120_000)

  it('按作品前缀列出对象（本地目录不在时从桶里认领用）', async () => {
    expect(await listObjects(config, `${prefix}/posts/1/`)).toEqual([
      { key: obj.key, size: body.length }
    ])
    expect(await listObjects(config, `${prefix}/posts/2/`)).toEqual([])
  })

  it('预签名读取地址能取回同样的字节，并支持 Range（视频拖动进度要用）', async () => {
    const url = remoteObjectUrl(config, obj.key)
    const full = Buffer.from(await (await fetch(url)).arrayBuffer())
    expect(full.equals(body)).toBe(true)

    const ranged = await fetch(url, { headers: { range: 'bytes=100-199' } })
    expect(ranged.status).toBe(206)
    expect(Buffer.from(await ranged.arrayBuffer()).equals(body.subarray(100, 200))).toBe(true)
  }, 120_000)
})
