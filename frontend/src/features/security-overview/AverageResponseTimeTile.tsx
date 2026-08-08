import { Timer } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { formatDurationSeconds } from '@/features/security-overview/logic'
import { useAlertResponseTime } from '@/hooks/api'

// F14.4: "average response time" is defined as analyst ack latency
// (detection -> F13.6 acknowledgement), a decision this task's own line
// asked for before building anything -- not time-to-detection, which is
// already measured elsewhere as inference latency. `sample_size === 0`
// (no acknowledgement with a parseable detection timestamp yet) is a
// real, honest empty state, not an error -- rendered via `unavailable`
// same as any other not-yet-populated tile.
export function AverageResponseTimeTile() {
  const responseTime = useAlertResponseTime()
  const average = responseTime.data?.average_seconds ?? null

  return (
    <StatCard
      label="Avg. Response Time"
      icon={Timer}
      loading={responseTime.isLoading}
      unavailable={
        !responseTime.isLoading && average === null
          ? tileUnavailableMessage(responseTime.error, 'No acknowledged alerts yet')
          : undefined
      }
      value={average !== null ? formatDurationSeconds(average) : undefined}
    />
  )
}
