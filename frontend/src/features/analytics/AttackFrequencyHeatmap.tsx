import type { PaginationState } from '@tanstack/react-table'
import { ChartCard } from '@/components/chart-card'
import { HeatmapChart } from '@/components/charts'
import { EmptyState } from '@/components/empty-state'
import { ChartSkeleton } from '@/components/skeletons'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { buildAttackFrequencyGrid, findGridPeak } from '@/features/analytics/logic'
import { useEntityScores, useMotifCompletions } from '@/hooks/api'
import { useTimeRangeStore } from '@/store/timeRangeStore'

// F12.6: when attacks happen, by UTC day-of-week x hour (UTC so the grid
// can't disagree between analysts in different timezones). Leads with the
// busiest slot -- the thing an analyst actually looks for in a heatmap.

const COMPLETIONS_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }
const SCORE_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }
const TABLE_ROW_LIMIT = 20

export function AttackFrequencyHeatmap() {
  const range = useTimeRangeStore((state) => state.range)
  const completions = useMotifCompletions(COMPLETIONS_SAMPLE_PAGE, { range })
  const scores = useEntityScores(SCORE_SAMPLE_PAGE, range)

  const isLoading = completions.isLoading || scores.isLoading
  const isReady = completions.isSuccess && scores.isSuccess
  const grid = isReady ? buildAttackFrequencyGrid(completions.rows, scores.rows) : null
  const hasData = grid?.values.some((row) => row.some((count) => count > 0)) ?? false
  const error = completions.error ?? scores.error
  const peak = grid ? findGridPeak(grid.values) : null

  const busiest = grid
    ? grid.values
        .flatMap((row, r) =>
          row.map((value, c) => ({
            slot: `${grid.rowLabels[r]} ${grid.columnLabels[c]}:00`,
            value,
          })),
        )
        .filter((cell) => cell.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, TABLE_ROW_LIMIT)
    : []

  return (
    <ChartCard
      title="Attack Frequency (UTC)"
      headline={
        peak && grid
          ? `${grid.rowLabels[peak.row]} ${grid.columnLabels[peak.column]}:00`
          : undefined
      }
      headlineUnit={
        peak ? `busiest slot · ${peak.value} event${peak.value === 1 ? '' : 's'}` : undefined
      }
      caption={
        hasData ? 'Motif completions and non-benign entity scores by UTC day and hour.' : undefined
      }
      refreshing={(completions.isFetching || scores.isFetching) && !isLoading}
      table={
        hasData
          ? {
              columns: ['Slot (UTC)', 'Events'],
              rows: busiest.map((cell) => [cell.slot, cell.value]),
            }
          : undefined
      }
    >
      {isLoading ? (
        <ChartSkeleton height={200} />
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
    </ChartCard>
  )
}
