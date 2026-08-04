import type { PaginationState } from '@tanstack/react-table'
import { Siren } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import {
  computeThreatStatus,
  THREAT_STATUS_LABEL,
  THREAT_STATUS_WINDOW_SECONDS,
  tileUnavailableMessage,
} from '@/features/dashboard/logic'
import { StatusPill } from '@/features/dashboard/status-pill'
import { useMotifCompletions } from '@/hooks/api'

const TONE = { quiet: 'success', active: 'warning', critical: 'error' } as const
const RECENT_COMPLETIONS_PAGE: PaginationState = { pageIndex: 0, pageSize: 20 }
const WINDOW_MINUTES = THREAT_STATUS_WINDOW_SECONDS / 60

// F6.3: threat status, from a recent-window count of `MotifCompletionEvent`s.
export function ThreatStatusTile() {
  const completions = useMotifCompletions(RECENT_COMPLETIONS_PAGE)
  // Anchored to when this response arrived (`dataUpdatedAt`), not a live
  // `Date.now()` read during render -- keeps the component pure/idempotent
  // and is arguably more correct anyway (a cached, slightly-stale read
  // shouldn't silently drift its own "recent" window as time passes).
  const result = completions.isSuccess
    ? computeThreatStatus(completions.rows, completions.dataUpdatedAt / 1000)
    : null

  return (
    <StatCard
      label="Threat Status"
      icon={Siren}
      loading={completions.isLoading}
      unavailable={
        !completions.isLoading && !result
          ? tileUnavailableMessage(completions.error, 'No detection data yet')
          : undefined
      }
      value={
        result && (
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={TONE[result.status]} label={THREAT_STATUS_LABEL[result.status]} />
            <span className="text-xs text-muted-foreground">
              {result.recentCount} in last {WINDOW_MINUTES}m
            </span>
          </div>
        )
      }
    />
  )
}
