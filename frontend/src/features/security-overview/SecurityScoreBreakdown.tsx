import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadErrorNotice } from '@/components/load-error-notice'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPenalty } from '@/features/dashboard/logic'
import { useSecurityScore } from '@/hooks/api'

// F0.12: why the cybersecurity score is what it is. The score is 100 minus
// these penalties; each row shows the backend's own description of its
// inputs, so the number can be explained without reading code. The
// anomalous-entity row is marked provisional because the T-GNN is
// untrained (specs.md §4).
export function SecurityScoreBreakdown() {
  const securityScore = useSecurityScore()
  const data = securityScore.data

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Score breakdown</CardTitle>
        <CardDescription>
          100 minus each penalty, over the last {data ? data.window_seconds / 3600 : 24} hours.
          {data && ` Formula v${data.formula_version}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {securityScore.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !data ? (
          <LoadErrorNotice failures={[{ label: 'Security score', error: securityScore.error }]} />
        ) : (
          <>
            <ul className="divide-y divide-border" aria-label="Score penalties">
              {data.components.map((component) => (
                <li key={component.key} className="flex flex-wrap items-baseline gap-x-3 py-2">
                  <span className="min-w-40 font-medium">{component.label}</span>
                  {component.provisional && <Badge variant="outline">Provisional</Badge>}
                  <span className="ml-auto font-mono text-sm tabular-nums">
                    &minus;{formatPenalty(component.penalty)}
                    <span className="text-muted-foreground"> of {component.max_penalty}</span>
                  </span>
                  <p className="w-full text-xs text-muted-foreground">{component.detail}</p>
                </li>
              ))}
            </ul>
            {data.pipeline_status === 'stale' && (
              <p className="mt-2 text-xs text-muted-foreground">
                The pipeline last reported {Math.round(data.snapshot_age_seconds ?? 0)} s ago, so
                the newest activity may be missing.
              </p>
            )}
            {data.inputs_truncated && (
              <p className="mt-2 text-xs text-muted-foreground">
                Only the most recent detections were counted: there were more in the window than the
                backend reads at once.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
