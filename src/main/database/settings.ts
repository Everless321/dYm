import { getDatabase } from './connection'

export function getSetting(key: string): string | null {
  const database = getDatabase()
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  const database = getDatabase()
  // 只记 key 与长度，settings 里有 Cookie / API Key，值不进日志
  console.log('[Database] setSetting:', key, `(${value.length} chars)`)
  database
    .prepare(
      `
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, strftime('%s', 'now'))
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = strftime('%s', 'now')
  `
    )
    .run(key, value, value)
}

export function getAllSettings(): Record<string, string> {
  const database = getDatabase()
  const rows = database.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string
    value: string
  }>
  return rows.reduce(
    (acc, row) => {
      acc[row.key] = row.value
      return acc
    },
    {} as Record<string, string>
  )
}
