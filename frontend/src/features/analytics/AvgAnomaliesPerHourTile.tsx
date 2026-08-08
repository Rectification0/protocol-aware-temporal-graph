import type { PaginationState } from '@tanstack/react-table'
import { Activity } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { computeRatePerHour } from '@/features/analytics/logic'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { useEntityScores } from '@/hooks/api'
import { useTimeRangeStore } from '@/store/timeRangeStore'

const TOTAL_ONLY_PAGE: PaginationState = { pageIndex: 0, pageSize: 1 }

// F8.5: average anomalies per hour over F8.1's selected range, from
// `InferenceResult` volume -- `entity_scores`' exact `COUNT(*)` once a
// range is applied (tasks.md F8.1's backing change). `entity_scores` is
// upserted/latest-value-only (CLAUDE.md's F0 notes), so this counts
// entities whose *latest* score falls in the range, not a true rolling
// anomaly-event count -- documented via the `title` tooltip rather than
// glossed over, same honesty standard F7.2's trend chart already holds
// itself to for the same underlying data.
export function AvgAnomaliesPerHourTile() {
  const range = useTimeRangeStore((state) => state.range)
  const scores = useEntityScores(TOTAL_ONLY_PAGE, range)
  const rate =
    scores.isSuccess && scores.total !== null
      ? computeRatePerHour(scores.total, range.start, range.end)
      : null

  return (
    <StatCard
      label="Avg. Anomalies / Hour"
      icon={Activity}
      loading={scores.isLoading}
      unavailable={
        !scores.isLoading && rate === null
          ? tileUnavailableMessage(scores.error, 'Not enough data for the selected range')
          : undefined
      }
      value={
        rate !== null && (
          <span title="entity_scores is latest-value-only -- counts entities whose latest score falls in the selected range, not a true historical anomaly count">
            {rate.toFixed(2)}
          </span>
        )
      }
    />
  )
}
