import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

/** 脚本定时常用预设，点一下直接填入，省得每次手写 cron */
const SCRIPT_CRON_PRESETS: { label: string; value: string }[] = [
  { label: '每 30 分钟', value: '*/30 * * * *' },
  { label: '每小时', value: '0 * * * *' },
  { label: '每 6 小时', value: '0 */6 * * *' },
  { label: '每天 3:00', value: '0 3 * * *' },
  { label: '每天 8:00', value: '0 8 * * *' },
  { label: '每周一 8:00', value: '0 8 * * 1' }
]

interface ScriptScheduleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scriptId: string
  scriptName: string
  /** 当前计划，未设置过为 null */
  schedule: ScriptScheduleInfo | null
  /** 保存后回传最新计划，null 表示计划已被清除 */
  onSaved: (info: ScriptScheduleInfo | null) => void
}

function formatNextRun(time: number | null): string {
  if (!time) return '—'
  const d = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 设置脚本的定时执行计划 */
export function ScriptScheduleDialog({
  open,
  onOpenChange,
  scriptId,
  scriptName,
  schedule,
  onSaved
}: ScriptScheduleDialogProps): React.JSX.Element {
  const [enabled, setEnabled] = useState(false)
  const [cron, setCron] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setEnabled(schedule?.enabled ?? false)
    setCron(schedule?.cron ?? '')
  }, [open, schedule])

  const handleSave = async (): Promise<void> => {
    const expression = cron.trim()
    if (enabled) {
      if (!expression) {
        toast.error('请填写 Cron 表达式')
        return
      }
      const valid = await window.api.sync.validateCron(expression)
      if (!valid) {
        toast.error('Cron 表达式无效')
        return
      }
    }
    setSaving(true)
    try {
      const info = await window.api.scripts.setSchedule(scriptId, expression, enabled)
      onSaved(info)
      toast.success(
        info?.enabled ? `已设置定时执行，下次 ${formatNextRun(info.nextRun)}` : '已关闭定时执行'
      )
      onOpenChange(false)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>定时执行</DialogTitle>
          <DialogDescription>
            让「{scriptName}
            」按计划自动运行。应用需保持运行（可最小化到托盘），关闭期间错过的不会补跑。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-lg border border-[#E5E5E7] px-3 py-2.5">
          <div>
            <p className="text-sm text-[#1D1D1F]">启用定时执行</p>
            <p className="text-xs text-[#A1A1A6] mt-0.5">
              上一次还没跑完时，本次会跳过而不是并发执行
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="space-y-2">
          <Input
            value={cron}
            disabled={!enabled}
            placeholder="0 3 * * *"
            onChange={(e) => setCron(e.target.value)}
            className="font-mono"
          />
          <div className="flex flex-wrap gap-1.5">
            {SCRIPT_CRON_PRESETS.map((preset) => {
              const active = cron.trim() === preset.value
              return (
                <button
                  key={preset.value}
                  type="button"
                  disabled={!enabled}
                  onClick={() => setCron(preset.value)}
                  title={preset.value}
                  className={`h-7 px-2.5 rounded-md border text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    active
                      ? 'border-[#0A84FF] bg-[#E8F0FE] text-[#0A84FF]'
                      : 'border-[#E5E5E7] bg-white text-[#6E6E73] hover:bg-[#F2F2F4]'
                  }`}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>
          {schedule?.enabled && (
            <p className="text-xs text-[#A1A1A6]">
              当前计划下次执行：{formatNextRun(schedule.nextRun)}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
