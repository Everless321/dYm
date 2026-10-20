import {
  BILIBILI_AUDIO_QUALITIES,
  BILIBILI_CODECS,
  BILIBILI_VIDEO_QUALITIES,
  CREATOR_PLATFORM_LABEL,
  type BilibiliCreatorSettings,
  type CreatorPlatform
} from '@shared/platforms'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export interface CreatorFormState {
  remark: string
  max_download_count: number
  show_in_home: boolean
  auto_sync: boolean
  sync_cron: string
  live_record: boolean
  live_check_cron: string
  bilibili: BilibiliCreatorSettings
}

const SYNC_CRON_PRESETS: { label: string; value: string }[] = [
  { label: '每小时', value: '0 * * * *' },
  { label: '每 6 小时', value: '0 */6 * * *' },
  { label: '每天 8:00', value: '0 8 * * *' },
  { label: '每天 0:00', value: '0 0 * * *' }
]

export function CreatorSettingsFields({
  platform,
  form,
  onChange,
  showRemark = true,
  cronValid = true,
  liveCronValid = true,
  onCronEdit,
  onLiveCronEdit
}: {
  platform: CreatorPlatform | null
  form: CreatorFormState
  onChange: (patch: Partial<CreatorFormState>) => void
  showRemark?: boolean
  cronValid?: boolean
  liveCronValid?: boolean
  onCronEdit?: () => void
  onLiveCronEdit?: () => void
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      {platform ? (
        <p className="text-xs text-[#6E6E73]">
          当前平台：
          <span className="ml-1 font-medium text-[#1D1D1F]">
            {CREATOR_PLATFORM_LABEL[platform]}
          </span>
        </p>
      ) : (
        <p className="text-xs text-[#A1A1A6]">粘贴链接后会自动识别平台，并显示对应的设置。</p>
      )}
      {showRemark ? (
        <div className="space-y-2">
          <Label>备注</Label>
          <Input
            value={form.remark}
            onChange={(event) => onChange({ remark: event.target.value })}
            placeholder="添加备注..."
          />
        </div>
      ) : null}
      <div className="space-y-2">
        <Label>单次下载限制</Label>
        <Input
          type="number"
          min={0}
          value={form.max_download_count}
          onChange={(event) =>
            onChange({ max_download_count: parseInt(event.target.value, 10) || 0 })
          }
          placeholder="0 表示使用全局设置"
        />
        <p className="text-xs text-muted-foreground">设为 0 则使用系统全局设置</p>
      </div>
      <div className="flex items-center justify-between">
        <Label>在首页显示</Label>
        <Switch
          checked={form.show_in_home}
          onCheckedChange={(checked) => onChange({ show_in_home: checked })}
        />
      </div>
      <div className="border-t border-[#E5E5E7] pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>自动同步</Label>
            <p className="text-xs text-muted-foreground">按计划自动下载新作品</p>
          </div>
          <Switch
            checked={form.auto_sync}
            onCheckedChange={(checked) => onChange({ auto_sync: checked })}
          />
        </div>
        {form.auto_sync ? (
          <div className="space-y-2">
            <Label>同步计划 (Cron 表达式)</Label>
            <Input
              value={form.sync_cron}
              onChange={(event) => {
                onChange({ sync_cron: event.target.value })
                onCronEdit?.()
              }}
              placeholder="0 8 * * *"
              className={!cronValid ? 'border-red-500' : ''}
            />
            <div className="flex flex-wrap gap-1.5">
              {SYNC_CRON_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => {
                    onChange({ sync_cron: preset.value })
                    onCronEdit?.()
                  }}
                  className={`h-7 px-2.5 rounded-md border text-xs ${
                    form.sync_cron.trim() === preset.value
                      ? 'border-[#0A84FF] bg-[#E8F0FE] text-[#0A84FF]'
                      : 'border-[#E5E5E7] text-[#6E6E73]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {!cronValid ? <p className="text-xs text-red-500">Cron 表达式无效</p> : null}
          </div>
        ) : null}
      </div>
      {platform === 'douyin' ? (
        <DouyinFields
          form={form}
          onChange={onChange}
          liveCronValid={liveCronValid}
          onLiveCronEdit={onLiveCronEdit}
        />
      ) : null}
      {platform === 'bilibili' ? (
        <BilibiliFields value={form.bilibili} onChange={(bilibili) => onChange({ bilibili })} />
      ) : null}
    </div>
  )
}

function DouyinFields({
  form,
  onChange,
  liveCronValid,
  onLiveCronEdit
}: {
  form: CreatorFormState
  onChange: (patch: Partial<CreatorFormState>) => void
  liveCronValid: boolean
  onLiveCronEdit?: () => void
}): React.JSX.Element {
  return (
    <div className="border-t border-[#E5E5E7] pt-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Label>录制直播</Label>
          <p className="text-xs text-muted-foreground">按计划检测抖音开播并自动录制</p>
        </div>
        <Switch
          checked={form.live_record}
          onCheckedChange={(checked) => onChange({ live_record: checked })}
        />
      </div>
      {form.live_record ? (
        <div className="space-y-2">
          <Label>检测计划 (Cron 表达式)</Label>
          <Input
            value={form.live_check_cron}
            onChange={(event) => {
              onChange({ live_check_cron: event.target.value })
              onLiveCronEdit?.()
            }}
            placeholder="*/5 * * * *"
            className={!liveCronValid ? 'border-red-500' : ''}
          />
          {!liveCronValid ? <p className="text-xs text-red-500">Cron 表达式无效</p> : null}
        </div>
      ) : null}
    </div>
  )
}

function BilibiliFields({
  value,
  onChange
}: {
  value: BilibiliCreatorSettings
  onChange: (value: BilibiliCreatorSettings) => void
}): React.JSX.Element {
  return (
    <div className="border-t border-[#E5E5E7] pt-4 space-y-4">
      <div>
        <Label>下载内容</Label>
        <p className="text-xs text-muted-foreground">画质、编码和附件按这个创作者单独保存</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SelectField
          label="画质"
          value={String(value.videoQuality)}
          options={BILIBILI_VIDEO_QUALITIES.map((item) => ({
            value: String(item.id),
            label: item.label
          }))}
          onChange={(next) => onChange({ ...value, videoQuality: Number(next) })}
        />
        <SelectField
          label="视频编码"
          value={value.videoCodec}
          options={BILIBILI_CODECS.map((item) => ({ value: item.id, label: item.label }))}
          onChange={(next) =>
            onChange({ ...value, videoCodec: next as BilibiliCreatorSettings['videoCodec'] })
          }
        />
        <SelectField
          label="音质"
          value={String(value.audioQuality)}
          options={BILIBILI_AUDIO_QUALITIES.map((item) => ({
            value: String(item.id),
            label: item.label
          }))}
          onChange={(next) => onChange({ ...value, audioQuality: Number(next) })}
        />
      </div>
      <Toggle
        label="下载视频"
        checked={value.downloadVideo}
        onChange={(downloadVideo) => onChange({ ...value, downloadVideo })}
      />
      <Toggle
        label="下载音频"
        checked={value.downloadAudio}
        onChange={(downloadAudio) => onChange({ ...value, downloadAudio })}
      />
      <Toggle
        label="下载封面"
        checked={value.downloadCover}
        onChange={(downloadCover) => onChange({ ...value, downloadCover })}
      />
      <Toggle
        label="下载弹幕"
        checked={value.downloadDanmaku}
        onChange={(downloadDanmaku) => onChange({ ...value, downloadDanmaku })}
      />
      <Toggle
        label="下载字幕"
        checked={value.downloadSubtitle}
        onChange={(downloadSubtitle) => onChange({ ...value, downloadSubtitle })}
      />
      <Toggle
        label="下载全部分 P"
        hint="关闭时只下载第一 P，或链接里指定的那一 P"
        checked={value.downloadAllPages}
        onChange={(downloadAllPages) => onChange({ ...value, downloadAllPages })}
      />
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-[#1D1D1F]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-[#E5E5E7] bg-white px-2 text-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <Label>{label}</Label>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
