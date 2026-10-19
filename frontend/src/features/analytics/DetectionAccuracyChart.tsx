import { formatDistanceToNowStrict } from 'date-fns'
import { ChartCard } from '@/components/chart-card'
import { CategoryBarChart } from '@/components/charts'
import { EmptyState } from '@/components/empty-state'
import { ChartSkeleton } from '@/components/skeletons'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { buildDetectionAccuracyRows } from '@/features/analytics/logic'
import { usePilotReport } from '@/hooks/api'

// F12.3: precision/recall per detection path from the last `pilot.py`
// evaluation (F8.4's endpoint) -- a snapshot, labeled as such, not live.
// Rows keep their fixed metric order (not sorted by value) so the same
// metric is always in the same place.

export function DetectionAccuracyChart() {
  const report = usePilotReport()
  const rows = report.data ? buildDetectionAccuracyRows(report.data) : null
  const hasData = (rows?.length ?? 0) > 0
  const lead = rows?.[0]

  return (
    <ChartCard
      title="Detection Accuracy"
      headline={lead ? `${Math.round(lead.value)}%` : undefined}
      headlineUnit={lead?.label.toLowerCase()}
      caption={
        report.data && hasData
          ? `As of last pilot evaluation, ${formatDistanceToNowStrict(new Date(report.data.evaluated_at * 1000), { addSuffix: true })} -- not live.`
          : undefined
      }
      table={
        rows && hasData
          ? {
              columns: ['Metric', 'Rate'],
              rows: rows.map((r) => [r.label, `${r.value.toFixed(1)}%`]),
            }
          : undefined
      }
    >
      {report.isLoading ? (
        <ChartSkeleton height={160} />
      ) : report.error ? (
        <EmptyState
          title="No pilot evaluation yet"
          description={tileUnavailableMessage(
            report.error,
            'Run python -m t_gnn.pilot to record precision/recall.',
          )}
        />
      ) : rows && hasData ? (
        <CategoryBarChart
          data={rows}
          categoryKey="label"
          valueKey="value"
          label="Rate"
          valueSuffix="%"
          layout="horizontal"
          sortDescending={false}
        />
      ) : (
        <EmptyState
          title="No usable metrics"
          description="The recorded pilot report has no computable precision/recall for either detection path."
        />
      )}
    </ChartCard>
  )
}
