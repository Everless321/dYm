export type ScriptRunStatus = 'running' | 'ok' | 'error' | 'cancelled'
export type ScriptRunTrigger = 'hook' | 'manual' | 'replay' | 'system'

export interface ScriptRun {
  runId: string
  startedAt: number
  status: ScriptRunStatus
  trigger: ScriptRunTrigger
  title: string
  preview: string
  durationLabel: string | null
  logs: ScriptLogEntry[]
}

function isStartLine(message: string): boolean {
  return message.startsWith('⚡ ') || message.startsWith('▶ ')
}

function isEndLine(message: string): boolean {
  return message.startsWith('✔ ') || message.startsWith('■ ') || message.startsWith('✖ ')
}

function summarize(runId: string, logs: ScriptLogEntry[], maybeRunning: boolean): ScriptRun {
  const first = logs[0]
  const start = logs.find((entry) => isStartLine(entry.message)) ?? first
  const end = [...logs].reverse().find((entry) => isEndLine(entry.message))
  const previewEntry = logs.find(
    (entry) => !isStartLine(entry.message) && !isEndLine(entry.message)
  )

  let trigger: ScriptRunTrigger = 'manual'
  let title = '手动运行'
  const startMessage = start?.message ?? ''
  if (runId === 'system') {
    trigger = 'system'
    title = '系统'
  } else if (startMessage.startsWith('⚡ 钩子「')) {
    trigger = 'hook'
    const matched = startMessage.match(/^⚡ 钩子「([^」]+)」/)
    title = matched?.[1] ?? '钩子'
  } else if (startMessage.includes('再次执行')) {
    trigger = 'replay'
    const matched = startMessage.match(/上次的(.+)入参/)
    title = matched?.[1] ? `再次执行 · ${matched[1]}` : '再次执行'
  } else if (startMessage.startsWith('▶ ')) {
    trigger = 'manual'
    title = '手动运行'
  }

  let status: ScriptRunStatus = maybeRunning ? 'running' : 'ok'
  if (end?.message.startsWith('✔ ')) status = 'ok'
  else if (end?.message.startsWith('✖ ')) status = 'error'
  else if (end?.message.startsWith('■ ')) status = 'cancelled'
  else if (maybeRunning) status = 'running'
  else if (logs.some((entry) => entry.level === 'error')) status = 'error'

  const durationMatched = end?.message.match(/耗时\s+(.+?)\s*）?$/)
  const durationLabel = durationMatched?.[1]?.replace(/[）)]$/, '') ?? null

  return {
    runId,
    startedAt: first?.time ?? 0,
    status,
    trigger,
    title,
    preview: (previewEntry?.message ?? '').replace(/\s+/g, ' ').trim(),
    durationLabel,
    logs
  }
}

/** 按 runId 收成一次次执行，最新的在最上面 */
export function groupLogsIntoRuns(logs: ScriptLogEntry[], running: boolean): ScriptRun[] {
  const groups = new Map<string, ScriptLogEntry[]>()
  const order: string[] = []
  for (const entry of logs) {
    const existing = groups.get(entry.runId)
    if (existing) {
      existing.push(entry)
      continue
    }
    groups.set(entry.runId, [entry])
    order.push(entry.runId)
  }
  const latestId = order[order.length - 1]
  return order
    .map((runId) => {
      const entries = groups.get(runId) ?? []
      const lastMessage = entries[entries.length - 1]?.message ?? ''
      const stillRunning = running && runId === latestId && !isEndLine(lastMessage)
      return summarize(runId, entries, stillRunning)
    })
    .reverse()
}
