import type { PaginationState } from '@tanstack/react-table'
import { ChartCard } from '@/components/chart-card'
import { CategoryBarChart } from '@/components/charts'
import { EmptyState } from '@/components/empty-state'
import { ChartSkeleton } from '@/components/skeletons'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { buildTopTargetedResources } from '@/features/analytics/logic'
import { useEntityScores, useMotifCompletions } from '@/hooks/api'
import { useTimeRangeStore } from '@/store/timeRangeStore'

// F12.7: machines most often at the center of a detection -- see
// `logic.ts`'s `buildTopTargetedResources` for the `chain_key`/`entity_id`
// proxy (no `dst` field exists on either source). One series of nominal
// categories, so one color: shading bars by value would only re-encode
// their length.

const COMPLETIONS_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }
const SCORE_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }

export function TopTargetedResourcesChart() {
  const range = useTimeRangeStore((state) => state.range)
  const completions = useMotifCompletions(COMPLETIONS_SAMPLE_PAGE, { range })
  const scores = useEntityScores(SCORE_SAMPLE_PAGE, range)

  const isLoading = completions.isLoading || scores.isLoading
  const isReady = completions.isSuccess && scores.isSuccess
  const rows = isReady ? buildTopTargetedResources(completions.rows, scores.rows) : null
  const hasData = (rows?.length ?? 0) > 0
  const error = completions.error ?? scores.error
  const top = rows?.[0]

  return (
    <ChartCard
      title="Top Targeted Resources"
      headline={hasData ? rows!.length.toLocaleString('en-US') : undefined}
      headlineUnit={hasData ? `machine${rows!.length === 1 ? '' : 's'} targeted` : undefined}
      caption={
        top
          ? `Most targeted: ${top.resource} (${top.count} detection${top.count === 1 ? '' : 's'}).`
          : undefined
      }
      refreshing={(completions.isFetching || scores.isFetching) && !isLoading}
      table={
        rows && hasData
          ? { columns: ['Machine', 'Detections'], rows: rows.map((r) => [r.resource, r.count]) }
          : undefined
      }
    >
      {isLoading ? (
        <ChartSkeleton height={200} />
      ) : rows && hasData ? (
        <CategoryBarChart
          data={rows}
          categoryKey="resource"
          valueKey="count"
          label="Detections"
          layout="horizontal"
          showShare
        />
      ) : (
        <EmptyState
          title={error ? 'Unable to load targeted resources' : 'No targeted machines yet'}
          description={
            error
              ? tileUnavailableMessage(error, 'Something went wrong')
              : 'No machine has appeared in a motif completion or non-benign score in the selected range.'
          }
        />
      )}
    </ChartCard>
  )
}
