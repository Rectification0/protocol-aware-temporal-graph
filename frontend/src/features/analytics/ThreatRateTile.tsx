import type { PaginationState } from '@tanstack/react-table'
import { Gauge } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { computeRatePerHour } from '@/features/analytics/logic'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { useMotifCompletions } from '@/hooks/api'
import { useTimeRangeStore } from '@/store/timeRangeStore'

const TOTAL_ONLY_PAGE: PaginationState = { pageIndex: 0, pageSize: 1 }

// F8.4 (threat-rate half): attacks per hour over F8.1's selected range --
// `logic.ts`'s `computeRatePerHour()` applied to the same exact
// motif-completion count `AttacksInRangeTile` (F8.3) already fetches.
export function ThreatRateTile() {
  const range = useTimeRangeStore((state) => state.range)
  const completions = useMotifCompletions(TOTAL_ONLY_PAGE, { range })
  const rate =
    completions.isSuccess && completions.total !== null
      ? computeRatePerHour(completions.total, range.start, range.end)
      : null

  return (
    <StatCard
      label="Threat Rate"
      icon={Gauge}
      loading={completions.isLoading}
      unavailable={
        !completions.isLoading && rate === null
          ? tileUnavailableMessage(completions.error, 'Not enough data for the selected range')
          : undefined
      }
      value={
        rate !== null && (
          <span className="inline-flex items-baseline gap-1.5">
            <span>{rate.toFixed(2)}</span>
            <span className="text-xs font-normal text-muted-foreground">attacks/hr</span>
          </span>
        )
      }
    />
  )
}
