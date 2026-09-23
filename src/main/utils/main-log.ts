import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  type WriteStream
} from 'fs'
import { join } from 'path'
import { format } from 'util'
import { app } from 'electron'

/**
 * 把主进程的 console 输出同时写到 <userData>/logs/main.log。
 *
 * 排查问题时不用再从终端复制日志：文件就在数据目录里，远程也能直接读。
 * 启动时超过 MAX_BYTES 就轮换成 main.old.log，只留两份。
 * 写文件出任何错都只影响这份副本，控制台输出照旧。
 * 必须作为入口的第一个 import，才能收到其它模块的启动日志。
 */

const MAX_BYTES = 5 * 1024 * 1024
const LEVELS = ['log', 'info', 'warn', 'error'] as const

function openLogStream(): WriteStream | null {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'main.log')
    if (existsSync(file) && statSync(file).size > MAX_BYTES) {
      renameSync(file, join(dir, 'main.old.log'))
    }
    const stream = createWriteStream(file, { flags: 'a' })
    stream.on('error', () => {})
    return stream
  } catch {
    return null
  }
}

const stream = openLogStream()

if (stream) {
  stream.write(
    `\n===== 启动 ${new Date().toISOString()} v${app.getVersion()} ${process.platform} =====\n`
  )
  for (const level of LEVELS) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]): void => {
      original(...args)
      try {
        stream.write(`${new Date().toISOString()} [${level}] ${format(...args)}\n`)
      } catch {
        // 写不进去就算了，控制台已经输出过
      }
    }
  }
}
