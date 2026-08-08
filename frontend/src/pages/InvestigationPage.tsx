import type { PaginationState } from '@tanstack/react-table'
import { useParams } from 'react-router-dom'
import { DataTable } from '@/components/data-table'
import { BackendPendingState } from '@/components/empty-state'
import { StatCard } from '@/components/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { classifyEntityScore, THREAT_TIER_LABEL } from '@/features/analytics/logic'
import { StatusPill } from '@/features/dashboard/status-pill'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { timelineColumns, triggeredRuleColumns } from '@/features/investigation/columns'
import { entityType, FULL_HISTORY_WINDOW } from '@/features/investigation/logic'
import { useEntityForensics, useEntityScore, useMotifCompletions } from '@/hooks/api'

const TIER_TONE = { malicious: 'error', suspicious: 'warning', benign: 'success' } as const
const TRIGGERED_RULES_PAGE: PaginationState = { pageIndex: 0, pageSize: 50 }

// Milestone F10 (User Investigation): F10.3 (risk score), F10.4/F10.6
// (activity timeline, doubling as log history), F10.5 (triggered rules),
// and F10.7-F10.9 (`[BACKEND TODO]`, all blocked on F0.13).
export function Component() {
  const { entityId = '' } = useParams<{ entityId: string }>()
  const score = useEntityScore(entityId)
  const timeline = useEntityForensics(entityId, FULL_HISTORY_WINDOW.start, FULL_HISTORY_WINDOW.end)
  const triggeredRules = useMotifCompletions(TRIGGERED_RULES_PAGE, { chainKey: entityId })

  const tier = score.data ? classifyEntityScore(score.data.score) : null

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Investigation: {entityId}</h1>
        {entityType(entityId) && (
          <p className="text-sm text-muted-foreground">Entity type: {entityType(entityId)}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Risk Score"
          loading={score.isLoading}
          unavailable={
            !score.isLoading && !score.data
              ? tileUnavailableMessage(score.error, 'This entity has never been scored')
              : undefined
          }
          value={
            tier && (
              <div className="space-y-1.5">
                <StatusPill tone={TIER_TONE[tier]} label={THREAT_TIER_LABEL[tier]} />
                <p className="text-xs font-normal text-muted-foreground">
                  score {score.data?.score.toFixed(2)} -- provisional classification (tasks.md
                  F7.1/F10.3), pending F0.12
                </p>
              </div>
            )
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Activity Timeline / Log History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Every pruned edge touching this entity, from Neo4j cold storage -- the same data backs
            both "timeline" and "log history" (tasks.md F10.6): no separate store of raw events
            exists beyond this.
          </p>
          <DataTable
            columns={timelineColumns(entityId)}
            data={timeline.data ?? []}
            loading={timeline.isLoading}
            emptyMessage={
              timeline.isError
                ? tileUnavailableMessage(timeline.error, 'Unable to load activity')
                : 'No pruned-edge activity recorded for this entity yet.'
            }
            getRowId={(edge) => edge.edge_id}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Triggered Rules
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={triggeredRuleColumns}
            data={triggeredRules.rows}
            loading={triggeredRules.isLoading}
            emptyMessage={
              triggeredRules.isError
                ? tileUnavailableMessage(triggeredRules.error, 'Unable to load triggered rules')
                : 'This entity has never triggered a motif completion.'
            }
            getRowId={(completion) => String(completion.id)}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <BackendPendingState
          taskRef="F0.13"
          description="IP addresses -- no IP field exists in the edge schema yet (tasks.md F10.7)."
        />
        <BackendPendingState
          taskRef="F0.13"
          description="Devices -- no device field exists in the edge schema yet (tasks.md F10.8)."
        />
        <BackendPendingState
          taskRef="F0.13"
          description="Session history -- no session concept exists anywhere in this repo; fabricating session boundaries from the timeline above was deliberately avoided (tasks.md F10.9)."
        />
      </div>
    </section>
  )
}
