import { safeStorage } from 'electron'

const ENC_PREFIX = 'enc:'
const PLAIN_PREFIX = 'plain:'

function encryptionAvailable(): boolean {
  try {
    return (
      typeof safeStorage?.isEncryptionAvailable === 'function' &&
      safeStorage.isEncryptionAvailable()
    )
  } catch {
    return false
  }
}

/** 用系统钥匙串加密后存库；Linux 无可用后端等情况下退回明文并打前缀，读取时两种都认 */
export function sealSecret(value: string): string {
  if (!value) return ''
  if (encryptionAvailable()) {
    return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
  }
  return PLAIN_PREFIX + value
}

export function openSecret(stored: string | null | undefined): string {
  if (!stored) return ''
  if (stored.startsWith(ENC_PREFIX)) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
    } catch (error) {
      console.error(
        '[AI] 凭据解密失败（系统钥匙串变更？），需要重新填写:',
        (error as Error).message
      )
      return ''
    }
  }
  if (stored.startsWith(PLAIN_PREFIX)) return stored.slice(PLAIN_PREFIX.length)
  // 无前缀：旧数据或外部写入的明文
  return stored
}
