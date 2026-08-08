import type { PaginationState } from '@tanstack/react-table'
import { Users } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { tileUnavailableMessage } from '@/features/dashboard/logic'
import { StatusPill } from '@/features/dashboard/status-pill'
import { countUserThreatTiers, THREAT_TIER_LABEL } from '@/features/analytics/logic'
import { useEntityScores } from '@/hooks/api'

const TIER_TONE = { malicious: 'error', suspicious: 'warning', benign: 'success' } as const

// F0.3's scores endpoint caps `limit` at 500 (scores.py) -- this is a
// sample of the top-500 entities by |score|, not literally every user in
// the deployment. A true population count needs a dedicated aggregate
// endpoint, the same F0.12 gap tasks.md's F7.1 line already flags.
const SCORE_SAMPLE_PAGE: PaginationState = { pageIndex: 0, pageSize: 500 }

// F7.1: malicious/suspicious/benign user counts, from `logic.ts`'s
// provisional score-threshold buckets. Per tasks.md's own instruction,
// the caption below is load-bearing UI copy, not decoration -- these
// numbers must never read as an authoritative classification.
export function UserThreatCountsPanel() {
  const scores = useEntityScores(SCORE_SAMPLE_PAGE)
  const counts = scores.isSuccess ? countUserThreatTiers(scores.rows) : null

  return (
    <StatCard
      label="User Threat Tiers"
      icon={Users}
      loading={scores.isLoading}
      unavailable={
        !scores.isLoading && !counts
          ? tileUnavailableMessage(scores.error, 'No entity scores recorded yet')
          : undefined
      }
      value={
        counts && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill
                tone={TIER_TONE.malicious}
                label={`${counts.malicious} ${THREAT_TIER_LABEL.malicious}`}
              />
              <StatusPill
                tone={TIER_TONE.suspicious}
                label={`${counts.suspicious} ${THREAT_TIER_LABEL.suspicious}`}
              />
              <StatusPill
                tone={TIER_TONE.benign}
                label={`${counts.benign} ${THREAT_TIER_LABEL.benign}`}
              />
            </div>
            <p className="text-xs font-normal text-muted-foreground">
              Provisional score-threshold buckets (tasks.md F7.1) -- not a calibrated
              classification.
            </p>
          </div>
        )
      }
    />
  )
}
