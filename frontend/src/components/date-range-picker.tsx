import { useState } from 'react'
import { CalendarIcon } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// F5.8: date-range picker supporting F8's presets (last hour/24h/7d/30d)
// plus a custom range via the calendar. Re-exports react-day-picker's own
// `DateRange` type rather than redefining an incompatible one -- the
// Calendar primitive (F5, `mode="range"`) already speaks this type.

export type { DateRange }

interface Preset {
  label: string
  range: () => DateRange
}

const PRESETS: Preset[] = [
  {
    label: 'Last hour',
    range: () => ({ from: new Date(Date.now() - 60 * 60 * 1000), to: new Date() }),
  },
  {
    label: 'Last 24 hours',
    range: () => ({ from: new Date(Date.now() - 24 * 60 * 60 * 1000), to: new Date() }),
  },
  {
    label: 'Last 7 days',
    range: () => ({ from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), to: new Date() }),
  },
  {
    label: 'Last 30 days',
    range: () => ({ from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), to: new Date() }),
  },
]

function formatRange(range: DateRange | undefined): string {
  if (!range?.from) return 'Pick a date range'
  const dateFormat: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }
  if (!range.to) return range.from.toLocaleDateString(undefined, dateFormat)
  return `${range.from.toLocaleDateString(undefined, dateFormat)} - ${range.to.toLocaleDateString(undefined, dateFormat)}`
}

export interface DateRangePickerProps {
  value: DateRange | undefined
  onChange: (range: DateRange | undefined) => void
  className?: string
}

export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'justify-start text-left font-normal',
            !value?.from && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="mr-2 size-4" />
          {formatRange(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-auto gap-2 p-2" align="start">
        <div className="flex flex-col gap-1 border-r border-border pr-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset.label}
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => {
                onChange(preset.range())
                setOpen(false)
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          selected={value}
          onSelect={onChange}
          defaultMonth={value?.from}
          numberOfMonths={2}
        />
      </PopoverContent>
    </Popover>
  )
}
