import type { PaginationState } from '@tanstack/react-table'
import { Swords } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { useMotifCompletions } from '@/hooks/api'
import { useTimeRangeStore } from '@/store/timeRangeStore'

// Only `total` is needed, not the rows themselves -- same "just want the
// envelope's metadata" trick F6.2's `SecurityLevelTile` uses.
const TOTAL_ONLY_PAGE: PaginationState = { pageIndex: 0, pageSize: 1 }

// F8.3: exact count of motif completions ("attacks") in F8.1's selected
// range. Unlike F7.1/F8.2's entity-score sampling, `motif_completions` is
// an append-only log, so the backend's `COUNT(*)` (tasks.md F8.1's
// backing change, active whenever `start`/`end` is supplied) is a real
// total, not a page-bounded estimate.
export function AttacksInRangeTile() {
  const range = useTimeRangeStore((state) => state.range)
  const completions = useMotifCompletions(TOTAL_ONLY_PAGE, undefined, range)
  const count = completions.isSuccess ? completions.total : null

  return (
    <StatCard
      label="Attacks Detected"
      icon={Swords}
      loading={completions.isLoading}
      unavailable={
        !completions.isLoading && count === null
          ? tileUnavailableMessage(completions.error, 'No motif completions recorded yet')
          : undefined
      }
      value={count}
    />
  )
}
