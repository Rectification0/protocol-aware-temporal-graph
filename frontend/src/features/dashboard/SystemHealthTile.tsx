import { HeartPulse } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { DependencyDot, StatusPill } from '@/features/dashboard/status-pill'
import { useHealth } from '@/hooks/api'

// F6.4: system health tile -- process/pipeline dependency liveness, via
// `GET /api/health` (Postgres/Neo4j/Redis reachability + overall status).
export function SystemHealthTile() {
  const health = useHealth()

  return (
    <StatCard
      label="System Health"
      icon={HeartPulse}
      loading={health.isLoading}
      unavailable={
        !health.isLoading && !health.data
          ? tileUnavailableMessage(health.error, 'Health check unavailable')
          : undefined
      }
      value={
        health.data && (
          <div className="space-y-1.5">
            <StatusPill
              tone={health.data.status === 'ok' ? 'success' : 'error'}
              label={health.data.status === 'ok' ? 'Healthy' : 'Degraded'}
            />
            <div className="flex gap-3">
              <DependencyDot label="Postgres" ok={health.data.postgres} />
              <DependencyDot label="Neo4j" ok={health.data.neo4j} />
              <DependencyDot label="Redis" ok={health.data.redis} />
            </div>
          </div>
        )
      }
    />
  )
}
