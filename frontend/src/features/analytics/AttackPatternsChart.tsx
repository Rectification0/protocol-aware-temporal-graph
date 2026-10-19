import type { PaginationState } from '@tanstack/react-table'
import { ChartCard } from '@/components/chart-card'
import { CategoryBarChart } from '@/components/charts'
import { EmptyState } from '@/components/empty-state'
import { ChartSkeleton } from '@/components/skeletons'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import {
  buildAttackPatternCounts,
  computePeriodDelta,
  formatShare,
  previousRange,
} from '@/features/analytics/logic'
import { useMotifCompletions } from '@/hooks/api'
import { useTimeRangeStore } from '@/store/timeRangeStore'

// F12.8: motif completions grouped by `motif_name`. Leads with the range's
// completion count and its change vs the previous range (completions are
// append-only history, so -- unlike entity scores -- that comparison is real).

const COMPLETIONS_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }
const COUNT_ONLY_PAGE: PaginationState = { pageIndex: 0, pageSize: 1 }

export function AttackPatternsChart() {
  const range = useTimeRangeStore((state) => state.range)
  const completions = useMotifCompletions(COMPLETIONS_SAMPLE_PAGE, { range })
  const previous = useMotifCompletions(COUNT_ONLY_PAGE, { range: previousRange(range) })

  const rows = completions.isSuccess ? buildAttackPatternCounts(completions.rows) : null
  const hasData = (rows?.length ?? 0) > 0
  const sampleTotal = rows?.reduce((sum, row) => sum + row.count, 0) ?? 0
  const total = completions.total ?? sampleTotal
  const previousTotal = previous.isSuccess ? (previous.total ?? previous.rows.length) : null
  const top = rows?.[0]

  return (
    <ChartCard
      title="Most Common Attack Patterns"
      headline={hasData ? total.toLocaleString('en-US') : undefined}
      headlineUnit={hasData ? `completion${total === 1 ? '' : 's'}` : undefined}
      delta={
        hasData && previousTotal !== null
          ? { ...computePeriodDelta(total, previousTotal), upIsGood: false }
          : undefined
      }
      caption={
        top
          ? `${top.motifName} is ${formatShare(top.count, sampleTotal)} of completions${rows!.length > 1 ? ` across ${rows!.length} patterns` : ''}.`
          : undefined
      }
      refreshing={completions.isFetching && !completions.isLoading}
      table={
        rows && hasData
          ? {
              columns: ['Pattern', 'Completions', 'Share'],
              rows: rows.map((r) => [r.motifName, r.count, formatShare(r.count, sampleTotal)]),
            }
          : undefined
      }
    >
      {completions.isLoading ? (
        <ChartSkeleton height={160} />
      ) : rows && hasData ? (
        <CategoryBarChart
          data={rows}
          categoryKey="motifName"
          valueKey="count"
          label="Completions"
          layout="horizontal"
          showShare
        />
      ) : (
        <EmptyState
          title={completions.error ? 'Unable to load attack patterns' : 'No motif completions yet'}
          description={
            completions.error
              ? tileUnavailableMessage(completions.error, 'Something went wrong')
              : 'No motif has completed in the selected range.'
          }
        />
      )}
    </ChartCard>
  )
}
