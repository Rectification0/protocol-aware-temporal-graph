import { formatDistanceToNowStrict } from 'date-fns'
import { CategoryBarChart } from '@/components/charts'
import { EmptyState } from '@/components/empty-state'
import { ChartSkeleton } from '@/components/skeletons'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { buildDetectionAccuracyRows } from '@/features/analytics/logic'
import { usePilotReport } from '@/hooks/api'

// F12.3: `pilot.py`'s real precision/recall (F8.4's endpoint), as a
// four-bar breakdown rather than `DetectionRateTile`'s single-line
// summary -- same underlying report, same "as of last pilot evaluation,
// not live" caption, not a second disagreeing source.
export function DetectionAccuracyChart() {
  const report = usePilotReport()
  const rows = report.data ? buildDetectionAccuracyRows(report.data) : null
  const hasData = (rows?.length ?? 0) > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Detection Accuracy
        </CardTitle>
      </CardHeader>
      <CardContent>
        {report.isLoading ? (
          <ChartSkeleton />
        ) : report.error ? (
          // The common "no pilot evaluation has ever been run" case
          // surfaces as a 404 here (`usePilotReport`'s point fetch has no
          // "succeeded but empty" state the way a list endpoint would),
          // so this is the branch that actually fires for it in practice
          // -- `tileUnavailableMessage` prefers the backend's own error
          // detail over a generic message.
          <EmptyState
            title="No pilot evaluation yet"
            description={tileUnavailableMessage(
              report.error,
              'Run python -m t_gnn.pilot to record precision/recall.',
            )}
          />
        ) : rows && hasData ? (
          <>
            <CategoryBarChart
              data={rows}
              categoryKey="label"
              valueKey="value"
              label="Rate (%)"
              layout="horizontal"
              sortDescending={false}
            />
            {report.data && (
              <p className="mt-2 text-xs text-muted-foreground">
                As of last pilot evaluation,{' '}
                {formatDistanceToNowStrict(new Date(report.data.evaluated_at * 1000), {
                  addSuffix: true,
                })}{' '}
                -- not live.
              </p>
            )}
          </>
        ) : (
          // A report exists (no error) but neither path had a computable
          // precision/recall -- a rare edge case, not the common one above.
          <EmptyState
            title="No usable metrics"
            description="The recorded pilot report has no computable precision/recall for either detection path."
          />
        )}
      </CardContent>
    </Card>
  )
}
