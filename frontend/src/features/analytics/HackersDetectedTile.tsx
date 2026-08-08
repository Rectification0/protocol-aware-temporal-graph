import type { PaginationState } from '@tanstack/react-table'
import { UserX } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { countUserThreatTiers } from '@/features/analytics/logic'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { useEntityScores } from '@/hooks/api'
import { useTimeRangeStore } from '@/store/timeRangeStore'

// Same top-500-by-|score| sample caveat as `UserThreatCountsPanel`.
const SCORE_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }

// F8.2: "number of hackers detected" for F8.1's selected range -- the
// count of `User:*` entities classified `malicious` (`logic.ts`'s F7.1
// tiers). Same F7.1 classification caveat applies here per tasks.md's own
// F8.2 line: this is a count of entities crossing a provisional score
// threshold, not an authoritative "these are confirmed attackers" label.
export function HackersDetectedTile() {
  const range = useTimeRangeStore((state) => state.range)
  const scores = useEntityScores(SCORE_SAMPLE_PAGE, range)
  const count = scores.isSuccess ? countUserThreatTiers(scores.rows).malicious : null

  return (
    <StatCard
      label="Hackers Detected"
      icon={UserX}
      loading={scores.isLoading}
      unavailable={
        !scores.isLoading && count === null
          ? tileUnavailableMessage(scores.error, 'No entity scores recorded yet')
          : undefined
      }
      value={
        count !== null && (
          <span title="Provisional score-threshold classification (tasks.md F7.1/F8.2) -- not an authoritative label">
            {count}
          </span>
        )
      }
    />
  )
}
