import type { PaginationState } from '@tanstack/react-table'
import { HeatmapChart } from '@/components/charts'
import { EmptyState } from '@/components/empty-state'
import { ChartSkeleton } from '@/components/skeletons'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { buildAttackFrequencyGrid } from '@/features/analytics/logic'
import { useEntityScores, useMotifCompletions } from '@/hooks/api'
import { useTimeRangeStore } from '@/store/timeRangeStore'

// Same backend max-page-size sample-within-F8.1's-range posture as
// `ThreatTrendsChart`/`ThreatSeverityChart` above.
const COMPLETIONS_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }
const SCORE_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }

// F12.6: time-of-day x day-of-week attack frequency, via F5.5's
// `HeatmapChart` (built with exactly this chart in mind, per its own
// comment) and `logic.ts`'s `buildAttackFrequencyGrid`.
export function AttackFrequencyHeatmap() {
  const range = useTimeRangeStore((state) => state.range)
  const completions = useMotifCompletions(COMPLETIONS_SAMPLE_PAGE, { range })
  const scores = useEntityScores(SCORE_SAMPLE_PAGE, range)

  const isLoading = completions.isLoading || scores.isLoading
  const isReady = completions.isSuccess && scores.isSuccess
  const grid = isReady ? buildAttackFrequencyGrid(completions.rows, scores.rows) : null
  const hasData = grid?.values.some((row) => row.some((count) => count > 0)) ?? false
  const error = completions.error ?? scores.error

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Attack Frequency (UTC)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ChartSkeleton />
        ) : grid && hasData ? (
          <HeatmapChart
            rowLabels={grid.rowLabels}
            columnLabels={grid.columnLabels}
            values={grid.values}
          />
        ) : (
          <EmptyState
            title={error ? 'Unable to load attack frequency' : 'No recent activity'}
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
