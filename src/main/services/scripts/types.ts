/**
 * 自定义脚本运行时的类型契约。
 *
 * 内置脚本（编译进包）与外部脚本（用户数据目录下的 .js）共用同一套 ScriptApi，
 * 后续开放给他人编写时运行时接口无需变动。
 */

/** 脚本自述信息，内置与外部脚本都通过导出 meta 声明 */
export interface ScriptMeta {
  /** 展示名称 */
  name: string
  /** 一句话说明脚本做什么 */
  description?: string
  /** 执行超时（毫秒），默认 5 分钟 */
  timeout?: number
}

/** 脚本模块的形状：导出 meta 与 run */
export interface ScriptModule {
  meta: ScriptMeta
  run: (api: ScriptApi) => unknown | Promise<unknown>
}

/** 列表展示用的脚本条目 */
export interface ScriptDescriptor {
  /** 唯一 id：内置为 `builtin:<key>`，外部为 `external:<文件名>` */
  id: string
  source: 'builtin' | 'external'
  name: string
  description: string
  /** 外部脚本的文件绝对路径；内置为 null */
  filePath: string | null
  /** 加载失败时的原因，非空表示该脚本不可运行 */
  error: string | null
}

/** 单条运行日志 */
export interface ScriptLogEntry {
  scriptId: string
  runId: string
  /** 全局自增序号，渲染层据此去重与排序 */
  seq: number
  level: 'info' | 'error'
  message: string
  time: number
}

/** 运行结果 */
export interface ScriptRunResult {
  runId: string
  ok: boolean
  /** run() 的返回值，JSON 可序列化时透传，否则为 undefined */
  result?: unknown
  error?: string
  durationMs: number
}

/** 数据库行的通用形状 */
export type Row = Record<string, unknown>

/** 可更新的用户设置字段 */
export interface UserSettingsPatch {
  show_in_home?: boolean
  max_download_count?: number
  remark?: string
  auto_sync?: boolean
  sync_cron?: string
  live_record?: boolean
  live_check_cron?: string
}

/** 传给脚本的能力对象 */
export interface ScriptApi {
  /** 输出一行日志到运行面板 */
  log: (...args: unknown[]) => void

  /** 暂停指定毫秒数，用于给请求之间加间隔 */
  sleep: (ms: number) => Promise<void>

  db: {
    /** 只读查询，仅允许 SELECT / WITH 开头的语句 */
    query: <T = Row>(sql: string, params?: unknown[]) => T[]
    /** 写入语句（INSERT / UPDATE / DELETE 等） */
    exec: (sql: string, params?: unknown[]) => { changes: number; lastInsertRowid: number }
    users: {
      list: () => Row[]
      getBySecUid: (secUid: string) => Row | undefined
      /** 更新用户设置，只传需要改的字段 */
      updateSettings: (id: number, patch: UserSettingsPatch) => Row | undefined
      delete: (id: number) => { sec_uid: string } | undefined
    }
    posts: {
      listByUserId: (userId: number) => Row[]
      getByAwemeId: (awemeId: string) => Row | undefined
      setTags: (id: number, input: { aiTags?: string[]; manualTags?: string[] }) => void
      delete: (id: number) => Row | undefined
    }
    tags: {
      all: () => string[]
      rename: (oldName: string, newName: string) => number
      merge: (names: string[], into: string) => number
      delete: (names: string[]) => number
      addToPosts: (postIds: number[], tags: string[]) => number
    }
    settings: {
      get: (key: string) => string | null
      set: (key: string, value: string) => void
    }
  }

  actions: {
    /** 通过主页/作品链接添加用户（作品链接会按设置自动下载该作品） */
    addUser: (url: string) => Promise<unknown>
    /** 同步指定用户的作品列表 */
    syncUser: (userId: number) => Promise<void>
    /** 执行下载任务 */
    runTask: (taskId: number) => Promise<void>
    /** 发起分析，secUid 为空则分析全部未分析作品 */
    analyze: (secUid?: string) => Promise<void>
    /** 重新分析指定的多个作品 */
    reanalyzePosts: (postIds: number[]) => Promise<void>
  }

  fs: {
    /** 下载根目录绝对路径 */
    downloadRoot: string
    /** 用户数据目录绝对路径（数据库、脚本目录所在处） */
    userDataRoot: string
    exists: (path: string) => boolean
    /** 列出目录内容，返回名称与是否为目录 */
    list: (dir: string) => { name: string; path: string; isDirectory: boolean; size: number }[]
    read: (path: string) => string
    write: (path: string, content: string) => void
    /** 删除文件或整个目录 */
    remove: (path: string) => void
    move: (from: string, to: string) => void
    mkdir: (path: string) => void
  }

  net: {
    /** 发起 HTTP 请求，返回读取完毕的响应 */
    fetch: (
      url: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string }
    ) => Promise<{ status: number; ok: boolean; headers: Record<string, string>; body: string }>
  }
}
