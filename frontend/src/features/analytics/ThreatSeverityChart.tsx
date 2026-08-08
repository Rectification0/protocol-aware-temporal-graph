import type { PaginationState } from '@tanstack/react-table'
import { DonutChart } from '@/components/charts'
import { EmptyState } from '@/components/empty-state'
import { ChartSkeleton } from '@/components/skeletons'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { buildSeverityDistribution } from '@/features/analytics/logic'
import { useEntityScores } from '@/hooks/api'

// Same sample-size caveat as `UserThreatCountsPanel` -- top-500 by
// |score|, not every entity ever seen.
const SCORE_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }

// Severity here maps directly onto `status-pill.tsx`'s success/warning/error
// tone vocabulary (benign/suspicious/malicious), not `charts.tsx`'s default
// categorical `--chart-1..5` palette -- this genuinely *is* severity data,
// so it earns the `--status-*` tokens instead.
const TIER_COLOR: Record<string, string> = {
  Malicious: 'var(--status-error)',
  Suspicious: 'var(--status-warning)',
  Benign: 'var(--status-success)',
}

// F7.3: threat severity distribution, bucketed the same way as F7.1
// (`logic.ts`'s `buildSeverityDistribution`) but across every entity in
// the sample, not just users. Same threshold-provisionality caveat as
// F7.1 applies to this chart's slices.
export function ThreatSeverityChart() {
  const scores = useEntityScores(SCORE_SAMPLE_PAGE)
  const distribution = scores.isSuccess ? buildSeverityDistribution(scores.rows) : null
  const hasData = distribution?.some((slice) => slice.count > 0) ?? false
  const error = scores.error

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Threat Severity Distribution
        </CardTitle>
      </CardHeader>
      <CardContent>
        {scores.isLoading ? (
          <ChartSkeleton />
        ) : distribution && hasData ? (
          <DonutChart
            data={distribution}
            nameKey="label"
            valueKey="count"
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
      </CardContent>
    </Card>
  )
}
