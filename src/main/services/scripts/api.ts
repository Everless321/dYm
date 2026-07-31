import { app } from 'electron'
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  renameSync,
  mkdirSync,
  statSync
} from 'fs'
import { join, resolve, sep } from 'path'
import { inspect } from 'util'
import {
  getDatabase,
  getAllUsers,
  getUserBySecUid,
  updateUserSettings,
  deleteUser,
  getPostsByUserIdAll,
  getPostByAwemeId,
  setPostTags,
  deletePost,
  getAllTags,
  renameTag,
  mergeTags,
  deleteTags,
  addTagsToPosts,
  getSetting,
  setSetting
} from '../../database'
import { getDownloadPath } from '../media'
import { addUserByUrl } from '../user-add'
import { startUserSync } from '../syncer'
import { startDownloadTask } from '../downloader'
import { startAnalysis, reanalyzePosts } from '../analyzer'
import type { Row, ScriptApi } from './types'

/** 允许脚本读写的根目录：下载目录与用户数据目录 */
function allowedRoots(): string[] {
  return [resolve(getDownloadPath()), resolve(app.getPath('userData'))]
}

/**
 * 校验路径是否落在允许的根目录内，防止脚本误操作家目录等无关位置。
 * 返回解析后的绝对路径。
 */
function assertAllowedPath(path: string): string {
  const resolved = resolve(path)
  const roots = allowedRoots()
  const allowed = roots.some((root) => resolved === root || resolved.startsWith(root + sep))
  if (!allowed) {
    throw new Error(`路径超出允许范围：${resolved}\n允许的根目录：${roots.join('、')}`)
  }
  return resolved
}

/** 只读查询守卫：仅放行 SELECT / WITH 开头的语句 */
function assertReadOnly(sql: string): void {
  if (!/^\s*(select|with)\b/i.test(sql)) {
    throw new Error('api.db.query 仅允许 SELECT / WITH 查询，写入请用 api.db.exec')
  }
}

function formatLogArgs(args: unknown[]): string {
  return args
    .map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 4, breakLength: 100 })))
    .join(' ')
}

/**
 * 构造传给脚本的能力对象。
 * @param emit 日志回调，由 runner 接上 IPC 推送
 */
export function createScriptApi(
  emit: (level: 'info' | 'error', message: string) => void
): ScriptApi {
  return {
    log: (...args: unknown[]) => emit('info', formatLogArgs(args)),

    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),

    db: {
      query: <T = Row>(sql: string, params: unknown[] = []): T[] => {
        assertReadOnly(sql)
        return getDatabase()
          .prepare(sql)
          .all(...params) as T[]
      },
      exec: (sql: string, params: unknown[] = []) => {
        const info = getDatabase()
          .prepare(sql)
          .run(...params)
        return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }
      },
      users: {
        list: () => getAllUsers() as unknown as Row[],
        getBySecUid: (secUid: string) => getUserBySecUid(secUid) as unknown as Row | undefined,
        updateSettings: (id, patch) => updateUserSettings(id, patch) as unknown as Row | undefined,
        delete: (id: number) => deleteUser(id)
      },
      posts: {
        listByUserId: (userId: number) => getPostsByUserIdAll(userId) as unknown as Row[],
        getByAwemeId: (awemeId: string) => getPostByAwemeId(awemeId) as unknown as Row | undefined,
        setTags: (id, input) => setPostTags(id, input),
        delete: (id: number) => deletePost(id) as unknown as Row | undefined
      },
      tags: {
        all: () => getAllTags(),
        rename: (oldName: string, newName: string) => renameTag(oldName, newName),
        merge: (names: string[], into: string) => mergeTags(names, into),
        delete: (names: string[]) => deleteTags(names),
        addToPosts: (postIds: number[], tags: string[]) => addTagsToPosts(postIds, tags)
      },
      settings: {
        get: (key: string) => getSetting(key),
        set: (key: string, value: string) => setSetting(key, value)
      }
    },

    actions: {
      addUser: (url: string) => addUserByUrl(url),
      syncUser: (userId: number) => startUserSync(userId, { source: 'manual' }),
      runTask: (taskId: number) => startDownloadTask(taskId, { source: 'manual' }),
      analyze: (secUid?: string) => startAnalysis(secUid),
      reanalyzePosts: (postIds: number[]) => reanalyzePosts(postIds)
    },

    fs: {
      downloadRoot: getDownloadPath(),
      userDataRoot: app.getPath('userData'),
      exists: (path: string) => existsSync(assertAllowedPath(path)),
      list: (dir: string) => {
        const root = assertAllowedPath(dir)
        return readdirSync(root, { withFileTypes: true }).map((entry) => {
          const full = join(root, entry.name)
          let size = 0
          try {
            size = entry.isDirectory() ? 0 : statSync(full).size
          } catch {
            size = 0
          }
          return { name: entry.name, path: full, isDirectory: entry.isDirectory(), size }
        })
      },
      read: (path: string) => readFileSync(assertAllowedPath(path), 'utf-8'),
      write: (path: string, content: string) =>
        writeFileSync(assertAllowedPath(path), content, 'utf-8'),
      remove: (path: string) => rmSync(assertAllowedPath(path), { recursive: true, force: true }),
      move: (from: string, to: string) =>
        renameSync(assertAllowedPath(from), assertAllowedPath(to)),
      mkdir: (path: string) => {
        mkdirSync(assertAllowedPath(path), { recursive: true })
      }
    },

    net: {
      fetch: async (url, init) => {
        const response = await fetch(url, {
          method: init?.method ?? 'GET',
          headers: init?.headers,
          body: init?.body
        })
        const headers: Record<string, string> = {}
        response.headers.forEach((value, key) => {
          headers[key] = value
        })
        return {
          status: response.status,
          ok: response.ok,
          headers,
          body: await response.text()
        }
      }
    }
  }
}
