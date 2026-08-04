import { Activity } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import {
  computeMonitoringStatus,
  MONITORING_STATUS_LABEL,
  tileUnavailableMessage,
} from '@/features/dashboard/logic'
import { StatusPill } from '@/features/dashboard/status-pill'
import { useHealth } from '@/hooks/api'

const TONE = { active: 'success', stale: 'warning', inactive: 'error' } as const

// F6.5: active monitoring status -- "derived the same way as F6.4"
// (tasks.md), i.e. from `/api/health`, but reading a different field:
// whether the pipeline process itself still appears to be writing
// (`last_metrics_snapshot_age_seconds`), not whether the infra it writes
// to is merely reachable.
export function MonitoringStatusTile() {
  const health = useHealth()
  const status = health.data
    ? computeMonitoringStatus(health.data.last_metrics_snapshot_age_seconds)
    : null

  return (
    <StatCard
      label="Active Monitoring"
      icon={Activity}
      loading={health.isLoading}
      unavailable={
        !health.isLoading && !status
          ? tileUnavailableMessage(health.error, 'Monitoring status unavailable')
          : undefined
      }
      value={status && <StatusPill tone={TONE[status]} label={MONITORING_STATUS_LABEL[status]} />}
    />
  )
}
