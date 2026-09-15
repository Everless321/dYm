import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'

const SORT_OPTIONS: { value: PostSortField; label: string }[] = [
  { value: 'create_time', label: '发布时间' },
  { value: 'downloaded_at', label: '下载时间' },
  { value: 'analyzed_at', label: '分析时间' },
  { value: 'analysis_content_level', label: '内容评级' }
]

interface SortSelectProps {
  value: PostSortConfig
  onChange: (sort: PostSortConfig) => void
}

export function SortSelect({ value, onChange }: SortSelectProps): React.JSX.Element {
  const currentLabel = SORT_OPTIONS.find((o) => o.value === value.field)?.label || '排序'

  const handleFieldChange = (field: string): void => {
    onChange({ ...value, field: field as PostSortField })
  }

  const toggleOrder = (): void => {
    onChange({ ...value, order: value.order === 'ASC' ? 'DESC' : 'ASC' })
  }

  return (
    <div className="flex items-center gap-1">
      <Select value={value.field} onValueChange={handleFieldChange}>
        <SelectTrigger className="w-[120px] h-9">
          <ArrowUpDown className="h-3.5 w-3.5 mr-1.5 opacity-50" />
          <SelectValue>{currentLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0"
        onClick={toggleOrder}
        title={value.order === 'ASC' ? '升序（点击切换降序）' : '降序（点击切换升序）'}
      >
        {value.order === 'ASC' ? (
          <ArrowUp className="h-4 w-4" />
        ) : (
          <ArrowDown className="h-4 w-4" />
        )}
      </Button>
    </div>
  )
}
