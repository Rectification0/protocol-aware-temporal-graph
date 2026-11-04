import { ShieldCheck } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import { securityScoreUnavailable } from '@/features/dashboard/logic'
import { useSecurityScore } from '@/hooks/api'

// F6.1: the company cybersecurity score (F0.12), computed by the backend
// from the last 24 h of detections, acknowledgements and entity scores.
// When the pipeline isn't reporting the backend withholds the number and
// says why; that reason is shown as-is rather than a stale or perfect score.
// The Security Overview page breaks the number down (`SecurityScoreBreakdown`).
export function CybersecurityScoreTile() {
  const securityScore = useSecurityScore()
  const score = securityScore.data?.score ?? null

  return (
    <StatCard
      label="Cybersecurity Score"
      icon={ShieldCheck}
      loading={securityScore.isLoading}
      unavailable={
        securityScore.isLoading
          ? undefined
          : securityScoreUnavailable(securityScore.data, securityScore.error)
      }
      value={
        score !== null ? (
          <>
            {Math.round(score)}
            <span className="text-sm font-normal text-muted-foreground"> / 100</span>
          </>
        ) : undefined
      }
    />
  )
}
