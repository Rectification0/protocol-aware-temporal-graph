import { DateRangePicker, type DateRange } from '@/components/date-range-picker'
import { useTimeRangeStore } from '@/store/timeRangeStore'

// F8.1: thin adapter between F5.8's `Date`-based `DateRangePicker` (which
// already implements the last-hour/24h/7d/30d presets plus a custom
// calendar range) and `timeRangeStore`'s unix-seconds `TimeRange` -- no
// changes needed to `DateRangePicker` itself.
export function TimeRangeFilter({ className }: { className?: string }) {
  const range = useTimeRangeStore((state) => state.range)
  const setRange = useTimeRangeStore((state) => state.setRange)

  const value: DateRange = { from: new Date(range.start * 1000), to: new Date(range.end * 1000) }

  function handleChange(next: DateRange | undefined) {
    if (!next?.from || !next?.to) return
    setRange({ start: next.from.getTime() / 1000, end: next.to.getTime() / 1000 })
  }

  return <DateRangePicker value={value} onChange={handleChange} className={className} />
}
