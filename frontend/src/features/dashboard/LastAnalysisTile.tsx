import { formatDistanceToNowStrict } from 'date-fns'
import { Clock } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { useHealth } from '@/hooks/api'

// F6.6: last analysis timestamp. `MetricsSnapshotOut` itself carries no
// timestamp field (metrics.py's dataclass doesn't need one internally,
// per CLAUDE.md's Phase 6 notes) -- `/api/health`'s
// `last_metrics_snapshot_age_seconds` is the one place that age is
// actually surfaced, so "now minus that age" is this tile's timestamp.
export function LastAnalysisTile() {
  const health = useHealth()
  const ageSeconds = health.data?.last_metrics_snapshot_age_seconds ?? null
  // Anchored to when this response arrived (`dataUpdatedAt`), not a live
  // `Date.now()` read during render -- keeps the component pure/idempotent.
  const lastAnalysisAt =
    ageSeconds !== null ? new Date(health.dataUpdatedAt - ageSeconds * 1000) : null

  return (
    <StatCard
      label="Last Analysis"
      icon={Clock}
      loading={health.isLoading}
      unavailable={
        !health.isLoading && !lastAnalysisAt
          ? tileUnavailableMessage(health.error, 'No pipeline activity recorded yet')
          : undefined
      }
      value={
        lastAnalysisAt && (
          <span title={lastAnalysisAt.toLocaleString()}>
            {formatDistanceToNowStrict(lastAnalysisAt, { addSuffix: true })}
          </span>
        )
      }
    />
  )
}
