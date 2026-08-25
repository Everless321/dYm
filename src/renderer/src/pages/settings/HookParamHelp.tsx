import type { HookParamField, ScriptHookOption } from '@/lib/script-hooks'

interface HookParamHelpProps {
  option: ScriptHookOption
  compact?: boolean
}

/** 钩子入参说明：创建时和详情页共用，避免两处各写一串字段名 */
export function HookParamHelp({
  option,
  compact = false
}: HookParamHelpProps): React.JSX.Element | null {
  if (option.fields.length === 0) {
    return <p className="text-xs text-[#6E6E73] leading-5">{option.when}</p>
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-2.5'}>
      <p className="text-xs text-[#6E6E73] leading-5">{option.when}</p>
      <p className="text-[11px] text-[#A1A1A6]">run(api, event) 入参</p>
      <div className={compact ? 'max-h-40 overflow-y-auto space-y-2 pr-1' : 'space-y-2'}>
        {option.fields.map((field) => (
          <HookParamRow key={field.name} field={field} />
        ))}
      </div>
    </div>
  )
}

function HookParamRow({ field }: { field: HookParamField }): React.JSX.Element {
  return (
    <div className="leading-5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <code className="text-[11px] text-[#1D1D1F] font-mono">{field.name}</code>
        <span className="text-[11px] text-[#A1A1A6] font-mono">{field.type}</span>
      </div>
      <p className="text-[11px] text-[#6E6E73] mt-0.5">{field.desc}</p>
    </div>
  )
}
