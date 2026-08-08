import { formatDistanceToNowStrict } from 'date-fns'
import { Target } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { usePilotReport } from '@/hooks/api'

function formatRate(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

// F8.4 (detection-rate half): `pilot.py`'s real precision/recall,
// labeled "as of last pilot evaluation." Deliberately NOT scoped to
// F8.1's selected range -- a pilot report is a whole-dataset batch
// result (`pilot.py`'s own docstring), not something re-computed per
// range without re-running the tool, per tasks.md's own "not live"
// instruction for this metric.
export function DetectionRateTile() {
  const report = usePilotReport()

  return (
    <StatCard
      label="Detection Rate"
      icon={Target}
      loading={report.isLoading}
      unavailable={
        !report.isLoading && !report.data
          ? tileUnavailableMessage(report.error, 'No pilot evaluation has been run yet')
          : undefined
      }
      value={
        report.data && (
          <div className="space-y-1">
            <div className="flex flex-wrap gap-3 text-sm">
              <span>Anomaly recall: {formatRate(report.data.anomaly.recall)}</span>
              <span>Motif recall: {formatRate(report.data.motif.recall)}</span>
            </div>
            <p className="text-xs font-normal text-muted-foreground">
              As of last pilot evaluation,{' '}
              {formatDistanceToNowStrict(new Date(report.data.evaluated_at * 1000), {
                addSuffix: true,
              })}{' '}
              -- not live.
            </p>
          </div>
        )
      }
    />
  )
}
