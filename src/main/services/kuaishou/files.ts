/** 文件头判断，对照 KS-Downloader 的 FILE_SIGNATURES，只保留作品里常见的几种。 */
export function mediaExtension(bytes: Uint8Array): 'mp4' | 'jpg' | 'png' | 'webp' | 'm4a' | 'bin' {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (bytes.length >= 12 && ascii(bytes, 8, 4) === 'WEBP') return 'webp'
  const brand = ascii(bytes, 4, 8)
  if (brand.startsWith('ftyp')) {
    if (brand.includes('M4A') || brand.includes('mp4a')) return 'm4a'
    return 'mp4'
  }
  return 'bin'
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false
  return signature.every((value, index) => bytes[index] === value)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return ''
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}
