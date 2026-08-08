import type { PaginationState } from '@tanstack/react-table'
import { CategoryBarChart } from '@/components/charts'
import { EmptyState } from '@/components/empty-state'
import { ChartSkeleton } from '@/components/skeletons'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { buildAttackPatternCounts } from '@/features/analytics/logic'
import { useMotifCompletions } from '@/hooks/api'
import { useTimeRangeStore } from '@/store/timeRangeStore'

const COMPLETIONS_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }

// F12.8: motif-completion counts grouped by `motif_name` -- scales
// automatically as `config/motifs.yaml`'s library grows (see
// `logic.ts`'s `buildAttackPatternCounts` doc comment), no hardcoded
// motif-name list to update.
export function AttackPatternsChart() {
  const range = useTimeRangeStore((state) => state.range)
  const completions = useMotifCompletions(COMPLETIONS_SAMPLE_PAGE, { range })

  const rows = completions.isSuccess ? buildAttackPatternCounts(completions.rows) : null
  const hasData = (rows?.length ?? 0) > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Most Common Attack Patterns
        </CardTitle>
      </CardHeader>
      <CardContent>
        {completions.isLoading ? (
          <ChartSkeleton />
        ) : rows && hasData ? (
          <CategoryBarChart
            data={rows}
            categoryKey="motifName"
            valueKey="count"
            label="Completions"
            layout="horizontal"
          />
        ) : (
          <EmptyState
            title={
              completions.error ? 'Unable to load attack patterns' : 'No motif completions yet'
            }
            description={
              completions.error
                ? tileUnavailableMessage(completions.error, 'Something went wrong')
                : 'No motif has completed in the selected range.'
            }
          />
        )}
      </CardContent>
    </Card>
  )
}
