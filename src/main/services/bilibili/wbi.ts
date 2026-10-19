import { createHash } from 'crypto'

/**
 * WBI 签名。算法与 downkyicore `DownKyi.Core/BiliApi/Sign/WbiSign.cs` 一致：
 * mixin 表打乱 imgKey+subKey，参数按 key 排序、去掉 !'()*，再对 query+mixinKey 做 MD5。
 */
const MIXIN_KEY_ENCODING_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54,
  21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
]

export function mixinKey(origin: string): string {
  if (origin.length < 64) {
    throw new Error('WBI 密钥长度不足')
  }
  let mixed = ''
  for (const index of MIXIN_KEY_ENCODING_TABLE) {
    mixed += origin[index]
  }
  return mixed.slice(0, 32)
}

export function encodeWbi(
  parameters: Record<string, string | number>,
  imgKey: string,
  subKey: string,
  unixTimeSeconds: number
): Record<string, string> {
  if (!/^[A-Za-z0-9]{32}$/.test(imgKey) || !/^[A-Za-z0-9]{32}$/.test(subKey)) {
    throw new Error('WBI 密钥无效')
  }
  const mixed = mixinKey(imgKey + subKey)
  const entries: [string, string][] = []
  for (const [key, value] of Object.entries(parameters)) {
    const text = String(value).replace(/[!'()*]/g, '')
    entries.push([key, text])
  }
  entries.push(['wts', String(unixTimeSeconds)])
  entries.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))

  const signed = entries
    .map(([key, value]) => `${encodeFormComponent(key)}=${encodeFormComponent(value)}`)
    .join('&')
  const wRid = createHash('md5')
    .update(signed + mixed)
    .digest('hex')

  const result: Record<string, string> = {}
  for (const [key, value] of entries) result[key] = value
  result.w_rid = wRid
  return result
}

export function wbiQuery(parameters: Record<string, string>): string {
  return Object.entries(parameters)
    .map(([key, value]) => `${encodeFormComponent(key)}=${encodeFormComponent(value)}`)
    .join('&')
}

function encodeFormComponent(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+')
}
