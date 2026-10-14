// 同步计划常用预设，点一下直接填入，省得每次手写 cron
export const SYNC_CRON_PRESETS: { label: string; value: string }[] = [
  { label: '每小时', value: '0 * * * *' },
  { label: '每 3 小时', value: '0 */3 * * *' },
  { label: '每 6 小时', value: '0 */6 * * *' },
  { label: '每 12 小时', value: '0 */12 * * *' },
  { label: '每天 8:00', value: '0 8 * * *' },
  { label: '每天 12:00', value: '0 12 * * *' },
  { label: '每天 0:00', value: '0 0 * * *' },
  { label: '每周一 8:00', value: '0 0 * * 1' }
]
