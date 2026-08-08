import type { PaginationState } from '@tanstack/react-table'
import { TimeSeriesChart } from '@/components/charts'
import { EmptyState } from '@/components/empty-state'
import { ChartSkeleton } from '@/components/skeletons'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { buildThreatTrendSeries } from '@/features/analytics/logic'
import { useEntityScores, useMotifCompletions } from '@/hooks/api'

// Backend max page size for both endpoints (500) -- see `logic.ts`'s
// `buildThreatTrendSeries` doc comment for what this sample does and
// doesn't represent.
const COMPLETIONS_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }
const SCORE_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }

// F7.2: threat trends over the last 24h in hourly buckets, via F5.5's
// `TimeSeriesChart`. F8.1's real time-range control will eventually
// replace this fixed window.
export function ThreatTrendsChart() {
  const completions = useMotifCompletions(COMPLETIONS_SAMPLE_PAGE)
  const scores = useEntityScores(SCORE_SAMPLE_PAGE)

  const isLoading = completions.isLoading || scores.isLoading
  const isReady = completions.isSuccess && scores.isSuccess
  // Anchored to when the completions page arrived (`dataUpdatedAt`), not a
  // live `Date.now()` read during render -- same purity reasoning as
  // `features/dashboard`'s tiles.
  const series = isReady
    ? buildThreatTrendSeries(completions.rows, scores.rows, completions.dataUpdatedAt / 1000)
    : null
  const hasData = series?.some((point) => point.attacks > 0 || point.highRiskEntities > 0) ?? false
  const error = completions.error ?? scores.error

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Threat Trends (last 24h)
        </CardTitle>
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
                : 'No motif completions or high-risk entities in the last 24 hours.'
            }
          />
        )}
      </CardContent>
    </Card>
  )
}
