/**
 * 渲染端传来的 secUid / folderName 会直接拼进下载目录后 rmSync / openPath。
 * 空串会让 join(root, '') 退化成下载根目录，'..' 会跑到上一级；进入口先把它们挡住。
 */

// 抖音 sec_uid 仅含字母/数字/下划线/连字符
const SEC_UID_PATTERN = /^[A-Za-z0-9_-]+$/

export function assertSecUid(secUid: unknown): string {
  if (typeof secUid !== 'string' || !SEC_UID_PATTERN.test(secUid)) {
    throw new Error(`非法的 sec_uid：${String(secUid)}`)
  }
  return secUid
}

/** 单级目录名：不能为空、不能含路径分隔符、不能是 . / .. */
export function assertFolderName(name: unknown): string {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    /[\\/]/.test(name) ||
    name.includes('\0')
  ) {
    throw new Error(`非法的目录名：${String(name)}`)
  }
  return name
}
