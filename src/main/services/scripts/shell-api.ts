import { spawn } from 'child_process'
import { getSetting } from '../../database'
import { ScriptCancelledError } from './api'
import { getScriptsDir } from './loader'
import type { ScriptApi, ShellOptions, ShellResult } from './types'

/**
 * 脚本执行本地命令的能力。
 *
 * 这是整套 ScriptApi 里唯一能跳出应用边界的接口——能跑任意命令就等于能做
 * 你在终端里能做的一切。所以它由设置里的「允许脚本执行本地命令」单独管控，默认关闭。
 */

/** 设置项键名，与设置页保持一致 */
export const ALLOW_SHELL_KEY = 'scripts_allow_shell'

/** stdout / stderr 各自的缓冲上限，防止跑飞的进程把内存吃干 */
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024

/**
 * 从 Finder / 开始菜单启动的应用拿到的 PATH 很短，homebrew、pyenv 装的东西都不在里面。
 * 补上这些常见位置，省得脚本里必须写绝对路径。
 */
const EXTRA_PATH_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']

function assertAllowed(): void {
  if (getSetting(ALLOW_SHELL_KEY) !== 'true') {
    throw new Error(
      '脚本执行本地命令未开启。请到「设置 - 系统 - 允许脚本执行本地命令」打开后重试。'
    )
  }
}

function buildEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
  if (process.platform !== 'win32') {
    const dirs = (env.PATH ?? '').split(':').filter(Boolean)
    for (const dir of EXTRA_PATH_DIRS) {
      if (!dirs.includes(dir)) dirs.push(dir)
    }
    env.PATH = dirs.join(':')
  }
  return env
}

/**
 * 真正的执行逻辑。
 *
 * @param command shell 模式下是整条命令，否则是可执行文件
 * @param args 非 shell 模式下的参数，会被自动转义，不用自己加引号
 */
function execute(
  command: string,
  args: string[],
  options: ShellOptions,
  useShell: boolean,
  emit: (level: 'info' | 'error', message: string) => void,
  signal: AbortSignal
): Promise<ShellResult> {
  assertAllowed()
  if (signal.aborted) return Promise.reject(new ScriptCancelledError())

  const timeout = options.timeout ?? 0

  return new Promise<ShellResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || getScriptsDir(),
      env: buildEnv(options.env),
      shell: useShell,
      timeout: timeout > 0 ? timeout : undefined,
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    let truncated = false
    let settled = false

    // 「停止」要连子进程一起杀掉，否则脚本停了 python 还在跑
    const onAbort = (): void => {
      child.kill('SIGTERM')
    }
    signal.addEventListener('abort', onAbort, { once: true })

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      fn()
    }

    // 实时输出时按行推日志，半行先攒着，避免把一行拆成两条
    const pending = { stdout: '', stderr: '' }
    const collect = (stream: 'stdout' | 'stderr', chunk: string): void => {
      if (stream === 'stdout') {
        if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk
        else truncated = true
      } else if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk
      else truncated = true

      if (!options.log) return
      pending[stream] += chunk
      const lines = pending[stream].split('\n')
      pending[stream] = lines.pop() ?? ''
      for (const line of lines) {
        emit(stream === 'stderr' ? 'error' : 'info', line)
      }
    }

    child.stdout?.setEncoding('utf-8')
    child.stderr?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => collect('stdout', chunk))
    child.stderr?.on('data', (chunk: string) => collect('stderr', chunk))

    if (options.input !== undefined) {
      child.stdin?.end(options.input)
    }

    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(() => {
        if (signal.aborted) return reject(new ScriptCancelledError())
        if (error.code === 'ENOENT') {
          return reject(
            new Error(
              `找不到可执行文件：${command}。应用从图形界面启动时 PATH 很短，` +
                `请改用绝对路径（如 /opt/homebrew/bin/python3），或用 which 确认路径。`
            )
          )
        }
        reject(error)
      })
    })

    child.on('close', (code, signalName) => {
      finish(() => {
        // 收尾时把最后半行也推出去
        if (options.log) {
          if (pending.stdout) emit('info', pending.stdout)
          if (pending.stderr) emit('error', pending.stderr)
        }
        if (signal.aborted) return reject(new ScriptCancelledError())
        // spawn 的 timeout 到点会发 SIGTERM，和用户主动停止要区分开
        if (timeout > 0 && signalName === 'SIGTERM') {
          return reject(new Error(`命令执行超时（${timeout} ms）已被终止：${command}`))
        }
        if (truncated) {
          emit('error', `⚠ 命令输出超过 ${MAX_OUTPUT_BYTES / 1024 / 1024} MB，已截断`)
        }
        resolve({ code, ok: code === 0, stdout, stderr, signal: signalName })
      })
    })
  })
}

/** 构造 api.shell */
export function createShellApi(
  emit: (level: 'info' | 'error', message: string) => void,
  signal: AbortSignal
): ScriptApi['shell'] {
  return {
    run: (file, args = [], options = {}) => execute(file, args, options, false, emit, signal),
    exec: (command, options = {}) => execute(command, [], options, true, emit, signal),
    get allowed() {
      return getSetting(ALLOW_SHELL_KEY) === 'true'
    }
  }
}
