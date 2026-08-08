import { FileText } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { useMetricsSnapshot } from '@/hooks/api'

// F14.3 (processed-logs half): `MetricsSnapshot.total_edges_processed`, a
// new lifetime counter added this milestone -- `RollingRateCounter`
// (metrics.py) only tracks a trailing window, which can't answer "how
// many logs/edges has this pipeline processed" at all. One edge in this
// repo's pipeline *is* one processed log line (`_process_edge()`), so
// this is a real count, not an estimate.
export function ProcessedLogsTile() {
  const snapshot = useMetricsSnapshot()

  return (
    <StatCard
      label="Total Processed Logs"
      icon={FileText}
      loading={snapshot.isLoading}
      unavailable={
        !snapshot.isLoading && !snapshot.data
          ? tileUnavailableMessage(snapshot.error, 'No metrics snapshot recorded yet')
          : undefined
      }
      // Explicit locale: `toLocaleString()` with no argument follows the
      // runtime's own locale, which varies by machine/browser (caught by
      // this component's own test failing under a non-en-US locale) --
      // a shared SOC dashboard should format the same number the same
      // way for every analyst, not silently vary per viewer.
      value={snapshot.data?.total_edges_processed.toLocaleString('en-US')}
    />
  )
}
