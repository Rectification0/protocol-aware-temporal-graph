import type { PaginationState } from '@tanstack/react-table'
import { ShieldAlert } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import {
  computeSecurityLevel,
  SECURITY_LEVEL_LABEL,
  tileUnavailableMessage,
} from '@/features/dashboard/logic'
import { StatusPill } from '@/features/dashboard/status-pill'
import { useEntityScores, useMetricsSnapshot } from '@/hooks/api'

const LEVEL_TONE = { normal: 'success', elevated: 'warning', critical: 'error' } as const

// F6.2: overall security level, an interim proxy documented in
// `logic.ts` -- combines `MetricsSnapshot.motif_hit_rate_per_second` with
// the single highest-|score| entity currently on record.
const TOP_SCORE_PAGE: PaginationState = { pageIndex: 0, pageSize: 1 }

export function SecurityLevelTile() {
  const metrics = useMetricsSnapshot()
  const topScore = useEntityScores(TOP_SCORE_PAGE)

  const isLoading = metrics.isLoading || topScore.isLoading
  const level = metrics.data
    ? computeSecurityLevel(metrics.data, topScore.rows[0]?.score ?? null)
    : null

  return (
    <StatCard
      label="Security Level"
      icon={ShieldAlert}
      loading={isLoading}
      unavailable={
        !isLoading && !level
          ? tileUnavailableMessage(metrics.error, 'No metrics reported yet')
          : undefined
      }
      value={level && <StatusPill tone={LEVEL_TONE[level]} label={SECURITY_LEVEL_LABEL[level]} />}
    />
  )
}
