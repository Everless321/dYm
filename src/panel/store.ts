import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { EMPTY_COUNTS, EMPTY_LOGIN, type PanelCounts, type PanelLogin } from '../shared/panel'

export interface StoredKey {
  id: string
  name: string
  hash: string
  prefix: string
  createdAt: number
}

export interface StoredNode {
  id: string
  keyId: string
  name: string
  hostname: string
  version: string
  platform: string
  lastSeen: number
  login: PanelLogin
  counts: PanelCounts
}

interface StateFile {
  keys: StoredKey[]
  nodes: StoredNode[]
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function randomSecret(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}

export function secretsEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(hashSecret(actual))
  const right = Buffer.from(hashSecret(expected))
  return left.length === right.length && timingSafeEqual(left, right)
}

function emptyState(): StateFile {
  return { keys: [], nodes: [] }
}

export class PanelStore {
  private state: StateFile
  private readonly file: string

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.file = join(dataDir, 'state.json')
    this.state = this.load()
  }

  listKeys(): StoredKey[] {
    return this.state.keys.map((key) => ({ ...key }))
  }

  listNodes(): StoredNode[] {
    return this.state.nodes.map((node) => ({
      ...node,
      login: { ...node.login },
      counts: { ...node.counts }
    }))
  }

  getNode(id: string): StoredNode | undefined {
    return this.listNodes().find((node) => node.id === id)
  }

  getKey(id: string): StoredKey | undefined {
    return this.state.keys.find((key) => key.id === id)
  }

  issueKey(name: string): { id: string; key: string; name: string; nodeId: string } {
    const trimmed = name.trim().slice(0, 64) || '未命名'
    const key = `dym_${randomSecret(24)}`
    const keyRow: StoredKey = {
      id: randomUUID(),
      name: trimmed,
      hash: hashSecret(key),
      prefix: key.slice(0, 12),
      createdAt: Date.now()
    }
    const node: StoredNode = {
      id: randomUUID(),
      keyId: keyRow.id,
      name: trimmed,
      hostname: '',
      version: '',
      platform: '',
      lastSeen: 0,
      login: { ...EMPTY_LOGIN },
      counts: { ...EMPTY_COUNTS }
    }
    this.state.keys.push(keyRow)
    this.state.nodes.push(node)
    this.save()
    return { id: keyRow.id, key, name: trimmed, nodeId: node.id }
  }

  revokeKey(id: string): StoredNode | undefined {
    const key = this.state.keys.find((item) => item.id === id)
    if (!key) return undefined
    const node = this.state.nodes.find((item) => item.keyId === id)
    this.state.keys = this.state.keys.filter((item) => item.id !== id)
    this.state.nodes = this.state.nodes.filter((item) => item.keyId !== id)
    this.save()
    return node
  }

  authenticate(apiKey: string): { key: StoredKey; node: StoredNode } | undefined {
    const hash = hashSecret(apiKey)
    const hashBuf = Buffer.from(hash)
    const key = this.state.keys.find((item) => {
      const other = Buffer.from(item.hash)
      return other.length === hashBuf.length && timingSafeEqual(other, hashBuf)
    })
    if (!key) return undefined
    const node = this.state.nodes.find((item) => item.keyId === key.id)
    if (!node) return undefined
    return { key, node }
  }

  updateNode(id: string, patch: Partial<Omit<StoredNode, 'id' | 'keyId'>>): void {
    const node = this.state.nodes.find((item) => item.id === id)
    if (!node) return
    if (patch.name !== undefined) node.name = patch.name
    if (patch.hostname !== undefined) node.hostname = patch.hostname
    if (patch.version !== undefined) node.version = patch.version
    if (patch.platform !== undefined) node.platform = patch.platform
    if (patch.lastSeen !== undefined) node.lastSeen = patch.lastSeen
    if (patch.login) node.login = { ...patch.login }
    if (patch.counts) node.counts = { ...patch.counts }
    this.save()
  }

  private load(): StateFile {
    if (!existsSync(this.file)) return emptyState()
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StateFile>
      return {
        keys: Array.isArray(parsed.keys) ? parsed.keys : [],
        nodes: Array.isArray(parsed.nodes) ? parsed.nodes : []
      }
    } catch (error) {
      console.error('[Panel] 状态文件损坏，已忽略:', error)
      return emptyState()
    }
  }

  private save(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state))
    renameSync(tmp, this.file)
  }
}
