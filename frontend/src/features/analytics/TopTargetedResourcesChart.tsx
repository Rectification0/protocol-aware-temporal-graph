import type { PaginationState } from '@tanstack/react-table'
import { CategoryBarChart } from '@/components/charts'
import { EmptyState } from '@/components/empty-state'
import { ChartSkeleton } from '@/components/skeletons'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { buildTopTargetedResources } from '@/features/analytics/logic'
import { useEntityScores, useMotifCompletions } from '@/hooks/api'
import { useTimeRangeStore } from '@/store/timeRangeStore'

const COMPLETIONS_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }
const SCORE_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }

// F12.7: top `Machine:*` resources by detection frequency. See
// `logic.ts`'s `buildTopTargetedResources` doc comment for why this is a
// `chain_key`/`entity_id` proxy rather than a literal `dst` field, which
// neither `MotifCompletionOut` nor `EntityScoreOut` carries.
export function TopTargetedResourcesChart() {
  const range = useTimeRangeStore((state) => state.range)
  const completions = useMotifCompletions(COMPLETIONS_SAMPLE_PAGE, { range })
  const scores = useEntityScores(SCORE_SAMPLE_PAGE, range)

  const isLoading = completions.isLoading || scores.isLoading
  const isReady = completions.isSuccess && scores.isSuccess
  const rows = isReady ? buildTopTargetedResources(completions.rows, scores.rows) : null
  const hasData = (rows?.length ?? 0) > 0
  const error = completions.error ?? scores.error

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Top Targeted Resources
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <ChartSkeleton />
        ) : rows && hasData ? (
          <CategoryBarChart
            data={rows}
            categoryKey="resource"
            valueKey="count"
            label="Detections"
            layout="horizontal"
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
      </CardContent>
    </Card>
  )
}
