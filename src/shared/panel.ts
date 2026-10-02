/** 管理端与 dYm 节点之间的消息。两边共用，不能引用 Electron。 */

export interface PanelLogin {
  loggedIn: boolean
  nickname: string | null
  uniqueId: string | null
}

export interface PanelCounts {
  users: number
  posts: number
  runningTasks: number
  syncingUsers: number
}

export interface PanelSnapshot {
  name: string
  version: string
  hostname: string
  platform: string
  login: PanelLogin
  counts: PanelCounts
  at: number
}

export interface PanelNodeView {
  id: string
  name: string
  online: boolean
  hostname: string
  version: string
  platform: string
  lastSeen: number | null
  login: PanelLogin
  counts: PanelCounts
  keyId: string
  keyPrefix: string
}

export interface PanelKeyView {
  id: string
  name: string
  prefix: string
  createdAt: number
  nodeId: string
  online: boolean
}

export interface PanelMediaRef {
  kind: 'file' | 'remote'
  token?: string
  url?: string
}

export interface PanelMediaStat {
  kind: 'file' | 'missing'
  size?: number
  mime?: string
  name?: string
}

export const EMPTY_LOGIN: PanelLogin = { loggedIn: false, nickname: null, uniqueId: null }

export const EMPTY_COUNTS: PanelCounts = {
  users: 0,
  posts: 0,
  runningTasks: 0,
  syncingUsers: 0
}

export const PANEL_METHODS = [
  'status.get',
  'account.get',
  'users.list',
  'users.add',
  'users.delete',
  'users.refresh',
  'users.updateSettings',
  'users.sync',
  'users.stopSync',
  'posts.list',
  'tags.list',
  'tasks.list',
  'tasks.create',
  'tasks.update',
  'tasks.delete',
  'tasks.start',
  'tasks.stop',
  'media.stat'
] as const

export type PanelMethod = (typeof PANEL_METHODS)[number]

export function isPanelMethod(value: string): value is PanelMethod {
  return (PANEL_METHODS as readonly string[]).includes(value)
}

/** 二进制帧：1 字节类型 + 16 字节传输号 + 载荷。1 数据，2 结束，3 错误（载荷是 UTF-8 说明） */
export function encodeMediaFrame(kind: number, transferId: string, payload?: Buffer): Buffer {
  const id = transferIdBytes(transferId)
  return Buffer.concat([Buffer.from([kind]), id, payload ?? Buffer.alloc(0)])
}

export function decodeMediaFrame(
  buf: Buffer
): { kind: number; idHex: string; payload: Buffer } | null {
  if (buf.length < 17) return null
  return {
    kind: buf[0],
    idHex: buf.subarray(1, 17).toString('hex'),
    payload: buf.subarray(17)
  }
}

export function transferIdHex(transferId: string): string {
  return transferIdBytes(transferId).toString('hex')
}

function transferIdBytes(transferId: string): Buffer {
  const hex = transferId.replace(/-/g, '')
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error('无效的传输编号')
  }
  return Buffer.from(hex, 'hex')
}
