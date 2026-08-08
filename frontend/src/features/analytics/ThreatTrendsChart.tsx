import type { PaginationState } from '@tanstack/react-table'
import { TimeSeriesChart } from '@/components/charts'
import { EmptyState } from '@/components/empty-state'
import { ChartSkeleton } from '@/components/skeletons'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { buildThreatTrendSeries } from '@/features/analytics/logic'
import { useEntityScores, useMotifCompletions } from '@/hooks/api'
import { useTimeRangeStore } from '@/store/timeRangeStore'

// Backend max page size for both endpoints (500), *within F8.1's selected
// range* -- see `logic.ts`'s `buildThreatTrendSeries` doc comment for
// what this sample does and doesn't represent.
const COMPLETIONS_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }
const SCORE_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }

// F7.2: threat trends across F8.1's selected range, in a fixed number of
// buckets (`logic.ts`'s `THREAT_TREND_BUCKET_COUNT`) spread evenly across
// it, via F5.5's `TimeSeriesChart`.
export function ThreatTrendsChart() {
  const range = useTimeRangeStore((state) => state.range)
  const completions = useMotifCompletions(COMPLETIONS_SAMPLE_PAGE, { range })
  const scores = useEntityScores(SCORE_SAMPLE_PAGE, range)

  const isLoading = completions.isLoading || scores.isLoading
  const isReady = completions.isSuccess && scores.isSuccess
  const series = isReady
    ? buildThreatTrendSeries(completions.rows, scores.rows, range.start, range.end)
    : null
  const hasData = series?.some((point) => point.attacks > 0 || point.highRiskEntities > 0) ?? false
  const error = completions.error ?? scores.error

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Threat Trends</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ChartSkeleton />
        ) : series && hasData ? (
          <TimeSeriesChart
            data={series}
            xKey="label"
            series={[
              { key: 'attacks', label: 'Attacks (motif completions)' },
              { key: 'highRiskEntities', label: 'High-risk entities' },
            ]}
          />
        ) : (
          <EmptyState
            title={error ? 'Unable to load threat trends' : 'No recent activity'}
            description={
              error
                ? tileUnavailableMessage(error, 'Something went wrong')
                : 'No motif completions or high-risk entities in the selected range.'
            }
          />
        )}
      </CardContent>
    </Card>
  )
}
