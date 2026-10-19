import type { PaginationState } from '@tanstack/react-table'
import { ChartCard } from '@/components/chart-card'
import { DonutChart } from '@/components/charts'
import { EmptyState } from '@/components/empty-state'
import { ChartSkeleton } from '@/components/skeletons'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { buildSeverityDistribution } from '@/features/analytics/logic'
import { useEntityScores } from '@/hooks/api'
import { useTimeRangeStore } from '@/store/timeRangeStore'

// F7.3 / F12.4: how the scored population splits across F7.1's provisional
// tiers. Colors carry *meaning* here (the status scale), unlike a
// categorical series. No "vs previous period" delta: `entity_scores` keeps
// only each entity's latest score, so a previous-range count wouldn't be a
// real historical comparison.

const SCORE_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }

const TIER_COLOR: Record<string, string> = {
  Malicious: 'var(--status-error)',
  Suspicious: 'var(--status-warning)',
  Benign: 'var(--status-success)',
}

export function ThreatSeverityChart() {
  const range = useTimeRangeStore((state) => state.range)
  const scores = useEntityScores(SCORE_SAMPLE_PAGE, range)
  const distribution = scores.isSuccess ? buildSeverityDistribution(scores.rows) : null
  const hasData = distribution?.some((slice) => slice.count > 0) ?? false
  const error = scores.error

  const total = distribution?.reduce((sum, slice) => sum + slice.count, 0) ?? 0
  const malicious = distribution?.find((slice) => slice.tier === 'malicious')?.count ?? 0

  return (
    <ChartCard
      title="Threat Severity Distribution"
      headline={hasData ? malicious.toLocaleString('en-US') : undefined}
      headlineUnit={hasData ? `malicious of ${total.toLocaleString('en-US')} scored` : undefined}
      caption={
        hasData
          ? 'Latest score per entity in the range. Tier thresholds are provisional (F7.1).'
          : undefined
      }
      refreshing={scores.isFetching && !scores.isLoading}
      table={
        distribution && hasData
          ? {
              columns: ['Tier', 'Entities', 'Share'],
              rows: distribution.map((slice) => [
                slice.label,
                slice.count,
                total ? `${Math.round((slice.count / total) * 100)}%` : '--',
              ]),
            }
          : undefined
      }
    >
      {scores.isLoading ? (
        <ChartSkeleton height={220} />
      ) : distribution && hasData ? (
        <DonutChart
          data={distribution}
          nameKey="label"
          valueKey="count"
          centerCaption="entities"
          colors={distribution.map((slice) => TIER_COLOR[slice.label])}
        />
      ) : (
        <EmptyState
          title={error ? 'Unable to load severity distribution' : 'No detections yet'}
          description={
            error
              ? tileUnavailableMessage(error, 'Something went wrong')
              : 'No entity scores have been recorded yet.'
          }
        />
      )}
    </ChartCard>
  )
}
