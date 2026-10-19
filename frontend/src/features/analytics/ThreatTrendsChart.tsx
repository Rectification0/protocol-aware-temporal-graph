import type { PaginationState } from '@tanstack/react-table'
import { ChartCard } from '@/components/chart-card'
import { TimeSeriesChart } from '@/components/charts'
import { EmptyState } from '@/components/empty-state'
import { ChartSkeleton } from '@/components/skeletons'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import {
  buildThreatTrendSeries,
  computePeriodDelta,
  previousRange,
  summarizeSeries,
} from '@/features/analytics/logic'
import { useEntityScores, useMotifCompletions } from '@/hooks/api'
import { useTimeRangeStore } from '@/store/timeRangeStore'

// F7.2 / F12.1-F12.2: the Analytics page's hero chart. Leads with the
// range's attack count (exact -- the backend's range-bound `total`, not
// the 500-row sample) and its change vs the previous range of the same
// length; the chart draws from the sample across a fixed bucket count --
// see `logic.ts`'s `buildThreatTrendSeries` doc comment for the bucketing
// and the high-risk series' snapshot-in-time caveat.

const COMPLETIONS_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }
const SCORE_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }
// Only the previous period's *count* is needed -- one row, read its `total`.
const COUNT_ONLY_PAGE: PaginationState = { pageIndex: 0, pageSize: 1 }

export function ThreatTrendsChart() {
  const range = useTimeRangeStore((state) => state.range)
  const completions = useMotifCompletions(COMPLETIONS_SAMPLE_PAGE, { range })
  const scores = useEntityScores(SCORE_SAMPLE_PAGE, range)
  const previous = useMotifCompletions(COUNT_ONLY_PAGE, { range: previousRange(range) })

  const isLoading = completions.isLoading || scores.isLoading
  const isReady = completions.isSuccess && scores.isSuccess
  const series = isReady
    ? buildThreatTrendSeries(completions.rows, scores.rows, range.start, range.end)
    : null
  const hasData = series?.some((point) => point.attacks > 0 || point.highRiskEntities > 0) ?? false
  const error = completions.error ?? scores.error

  const attacks = completions.total ?? (series ? summarizeSeries(series, 'attacks').total : 0)
  const previousAttacks = previous.isSuccess ? (previous.total ?? previous.rows.length) : null
  const sampled = completions.total !== null && completions.total > completions.rows.length

  return (
    <ChartCard
      title="Threat Trends"
      hero
      headline={isReady ? attacks.toLocaleString('en-US') : undefined}
      headlineUnit={isReady ? (attacks === 1 ? 'attack' : 'attacks') : undefined}
      delta={
        isReady && previousAttacks !== null
          ? { ...computePeriodDelta(attacks, previousAttacks), upIsGood: false }
          : undefined
      }
      caption={
        isReady
          ? `Motif completions and high-risk entity scores in the selected range${sampled ? ` -- chart drawn from the most recent ${completions.rows.length}` : ''}.`
          : undefined
      }
      refreshing={(completions.isFetching || scores.isFetching) && !isLoading}
      table={
        series && hasData
          ? {
              columns: ['Bucket', 'Attacks', 'High-risk entities'],
              rows: series.map((point) => [point.spanLabel, point.attacks, point.highRiskEntities]),
            }
          : undefined
      }
    >
      {isLoading ? (
        <ChartSkeleton height={300} />
      ) : series && hasData ? (
        <TimeSeriesChart
          data={series}
          xKey="label"
          tooltipLabelKey="spanLabel"
          referenceKey="attacks"
          height={300}
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
    </ChartCard>
  )
}
