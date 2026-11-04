import { ShieldAlert } from 'lucide-react'
import { StatCard } from '@/components/stat-card'
import {
  SECURITY_SCORE_BAND_LABEL,
  SECURITY_SCORE_BAND_TONE,
  securityScoreUnavailable,
} from '@/features/dashboard/logic'
import { StatusPill } from '@/features/dashboard/status-pill'
import { useSecurityScore } from '@/hooks/api'

// F6.2: overall security level -- since F0.12, the cybersecurity score's
// band (85+ Good, 65-84 Fair, 40-64 Poor, under 40 Critical), so this tile
// and F6.1's number always agree. Shares F6.1's query, so it costs no
// second request.
export function SecurityLevelTile() {
  const securityScore = useSecurityScore()
  const band = securityScore.data?.band ?? null

  return (
    <StatCard
      label="Security Level"
      icon={ShieldAlert}
      loading={securityScore.isLoading}
      unavailable={
        securityScore.isLoading
          ? undefined
          : securityScoreUnavailable(securityScore.data, securityScore.error)
      }
      value={
        band && (
          <StatusPill
            tone={SECURITY_SCORE_BAND_TONE[band]}
            label={SECURITY_SCORE_BAND_LABEL[band]}
          />
        )
      }
    />
  )
}
