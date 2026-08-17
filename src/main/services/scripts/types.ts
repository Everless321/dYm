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
  /** 执行超时（毫秒）。不填或填 0 表示不限时长，脚本可以跑几十小时 */
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
  /** 外部脚本的文件名（含 .js）；内置为 null。重命名/删除以此为准 */
  fileName: string | null
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
  /** 是否因用户停止或超时而中断（区别于脚本自身报错） */
  cancelled?: boolean
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

/** 当前 cookie 对应的登录账号 */
export interface DouyinAccount {
  /** 抖音 uid，未登录时为 null */
  uid: string | null
  /** 抖音号，未登录时为 null */
  uniqueId: string | null
  loggedIn: boolean
}

/** 一个收藏夹 */
export interface DouyinCollect {
  id: string
  name: string
  /** 收藏夹里的作品数 */
  total: number
}

/** 作品列表里的一条摘要（收藏、收藏夹、作者作品列表共用） */
export interface CollectedAweme {
  awemeId: string
  desc: string
  /** 作者昵称 */
  nickname: string
  /** 作者 sec_uid */
  secUid: string
  /** 发布时间，Unix 秒；拿不到时为 0 */
  createTime: number
}

/** 单个作品的详细信息 */
export interface DouyinVideoInfo {
  awemeId: string
  desc: string
  /** 发布时间，Unix 秒 */
  createTime: number
  /** 时长（毫秒），图文作品为 null */
  duration: number | null
  /** 0 = 视频，其它值为图文；拿不到时为 null */
  awemeType: number | null
  /** 封面图地址 */
  cover: string | null
  /** 视频播放地址（无水印），图文作品为 null */
  videoUrl: string | null
  /** 图文作品的图片地址，视频作品为 null */
  images: string[] | null
  author: {
    secUid: string
    nickname: string
    uid: string | null
    uniqueId: string | null
  }
  stats: {
    digg: number | null
    comment: number | null
    collect: number | null
    share: number | null
  }
  /** 话题标签名 */
  hashtags: string[]
}

/** 作者资料 */
export interface DouyinUserInfo {
  secUid: string
  uid: string | null
  nickname: string
  signature: string
  /** 头像地址 */
  avatar: string | null
  /** 抖音号 */
  uniqueId: string | null
  shortId: string | null
  followerCount: number | null
  followingCount: number | null
  /** 作品数 */
  awemeCount: number | null
  /** 获赞总数 */
  totalFavorited: number | null
}

/** 执行本地命令的可选项 */
export interface ShellOptions {
  /** 工作目录，默认脚本目录 */
  cwd?: string
  /** 追加的环境变量，会与应用自身的环境合并 */
  env?: Record<string, string>
  /** 写给命令 stdin 的内容 */
  input?: string
  /** 超时毫秒数，不填或 0 表示不限时长 */
  timeout?: number
  /** 是否把 stdout / stderr 按行实时输出到运行面板，默认 false */
  log?: boolean
}

/** 命令执行结果 */
export interface ShellResult {
  /** 退出码；被信号杀掉时为 null */
  code: number | null
  /** 退出码是否为 0 */
  ok: boolean
  stdout: string
  stderr: string
  /** 被信号终止时的信号名，正常退出为 null */
  signal: NodeJS.Signals | null
}

/** 抖音链接的识别结果 */
export interface DouyinLink {
  type: 'user' | 'video' | 'unknown'
  /** 用户链接为 sec_uid，作品链接为 aweme_id，识别失败为空串 */
  id: string
}

/** 传给脚本的能力对象 */
export interface ScriptApi {
  /** 输出一行日志到运行面板 */
  log: (...args: unknown[]) => void

  /** 暂停指定毫秒数，用于给请求之间加间隔；点「停止」会立即中断等待 */
  sleep: (ms: number) => Promise<void>

  /** 是否已被请求停止。长时间的纯计算循环应主动检查此标记 */
  readonly cancelled: boolean

  /** 已被请求停止时抛出中断错误，用于在循环里主动让出 */
  throwIfCancelled: () => void

  db: {
    /** 只读查询，仅允许 SELECT / WITH 开头的语句 */
    query: <T = Row>(sql: string, params?: unknown[]) => T[]
    /** 写入语句（INSERT / UPDATE / DELETE 等） */
    exec: (sql: string, params?: unknown[]) => { changes: number; lastInsertRowid: number }
    users: {
      list: () => Row[]
      getById: (id: number) => Row | undefined
      getBySecUid: (secUid: string) => Row | undefined
      /** 更新用户设置，只传需要改的字段 */
      updateSettings: (id: number, patch: UserSettingsPatch) => Row | undefined
      delete: (id: number) => { sec_uid: string } | undefined
    }
    posts: {
      listByUserId: (userId: number) => Row[]
      getById: (id: number) => Row | undefined
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
    /** 添加单个作品：入库作者并按设置下载该作品。入参可以是作品链接或裸 aweme_id */
    addVideo: (urlOrAwemeId: string) => Promise<unknown>
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
    /** 按当前系统的分隔符拼接路径 */
    join: (...segments: string[]) => string
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

  /**
   * 抖音只读接口，走应用里配置的 cookie 与签名。
   * 收藏相关接口没有用户参数，抖音按 cookie 判断「我」是谁，拿到的都是登录账号自己的数据。
   */
  douyin: {
    /** 当前 cookie 对应的登录账号 */
    me: () => Promise<DouyinAccount>
    /** 查作品信息，入参可以是作品链接或裸 aweme_id */
    video: (urlOrAwemeId: string) => Promise<DouyinVideoInfo>
    /** 查作者资料，入参可以是主页链接或 sec_uid */
    user: (urlOrSecUid: string) => Promise<DouyinUserInfo>
    /** 拉作者的作品列表；不传 limit 会一直翻到最后一页 */
    userVideos: (secUid: string, limit?: number) => Promise<CollectedAweme[]>
    /** 识别抖音链接是主页还是作品，支持短链 */
    parseUrl: (url: string) => Promise<DouyinLink>
    /** 收藏夹列表 */
    collects: () => Promise<DouyinCollect[]>
    /** 指定收藏夹里的全部作品 */
    collectsVideos: (collectsId: string) => Promise<CollectedAweme[]>
    /** 「收藏」里的全部作品（含未归入收藏夹的） */
    collectionVideos: () => Promise<CollectedAweme[]>
  }

  /**
   * 执行本地命令。
   *
   * 需要在「设置 - 系统 - 允许脚本执行本地命令」里开启，默认关闭；
   * 关闭时调用会直接抛错。这是唯一能跳出应用边界的接口，开启后脚本能做的事
   * 与你在终端里能做的一样多。
   */
  shell: {
    /** 直接执行程序，args 自动转义，不经过 shell */
    run: (file: string, args?: string[], options?: ShellOptions) => Promise<ShellResult>
    /** 经系统 shell 执行整条命令，可用管道和重定向 */
    exec: (command: string, options?: ShellOptions) => Promise<ShellResult>
    /** 当前是否已在设置里开启 */
    readonly allowed: boolean
  }

  net: {
    /** 发起 HTTP 请求，返回读取完毕的响应 */
    fetch: (
      url: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string }
    ) => Promise<{ status: number; ok: boolean; headers: Record<string, string>; body: string }>
  }
}
