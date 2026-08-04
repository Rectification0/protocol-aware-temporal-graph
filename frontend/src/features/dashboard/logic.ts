import { getErrorMessage } from '@/api/client'
import type { MetricsSnapshotOut, MotifCompletionOut } from '@/types/api'

// F6's executive-dashboard tiles. Pure/testable derivations live here;
// the tile components (this folder) just wire a hook's result through
// one of these and render the result via F5.3's `StatCard`.

// --- F6.2: overall security level ---------------------------------------
//
// F0.12 (a real, backend-computed aggregate score) doesn't exist yet
// (tasks.md `[BACKEND TODO]`) -- this is the "simpler interim proxy"
// tasks.md's own F6.2 line explicitly allows, using two signals that
// already exist: `MetricsSnapshot.motif_hit_rate_per_second` (a real rate
// of *full* structural pattern matches, FR3.4 -- not fabricated) and the
// single highest-|score| entity currently on record. The entity-score
// half leans on the same "relative magnitude is meaningful, absolute
// value/sign is not" reading of the untrained reference model that
// `score_entities.py` already establishes (specs.md §4) -- these
// thresholds are illustrative constants, not a calibrated formula, and
// should be revisited (or replaced outright) once F0.12 exists.

export type SecurityLevel = 'normal' | 'elevated' | 'critical'

export const SECURITY_LEVEL_THRESHOLDS = {
  hitRatePerSecond: { elevated: 0, critical: 0.05 },
  maxAbsScore: { elevated: 3, critical: 6 },
} as const

export const SECURITY_LEVEL_LABEL: Record<SecurityLevel, string> = {
  normal: 'Normal',
  elevated: 'Elevated',
  critical: 'Critical',
}

function severityRank(level: SecurityLevel): number {
  return { normal: 0, elevated: 1, critical: 2 }[level]
}

function levelFromHitRate(hitRatePerSecond: number): SecurityLevel {
  const { elevated, critical } = SECURITY_LEVEL_THRESHOLDS.hitRatePerSecond
  if (hitRatePerSecond > critical) return 'critical'
  if (hitRatePerSecond > elevated) return 'elevated'
  return 'normal'
}

function levelFromScore(topScore: number | null): SecurityLevel {
  if (topScore === null) return 'normal'
  const { elevated, critical } = SECURITY_LEVEL_THRESHOLDS.maxAbsScore
  const magnitude = Math.abs(topScore)
  if (magnitude > critical) return 'critical'
  if (magnitude > elevated) return 'elevated'
  return 'normal'
}

/** `topScore` is the raw (possibly negative) `EntityScoreOut.score` of
 * whichever entity currently has the highest `abs(score)` -- the sign
 * carries no fixed meaning (specs.md §4), so this takes its magnitude
 * itself rather than requiring every call site to remember to. */
export function computeSecurityLevel(
  metrics: MetricsSnapshotOut,
  topScore: number | null,
): SecurityLevel {
  const fromHitRate = levelFromHitRate(metrics.motif_hit_rate_per_second)
  const fromScore = levelFromScore(topScore)
  return severityRank(fromHitRate) >= severityRank(fromScore) ? fromHitRate : fromScore
}

// --- F6.3: threat status (recent MotifCompletionEvent count) -----------

export type ThreatStatus = 'quiet' | 'active' | 'critical'

export const THREAT_STATUS_WINDOW_SECONDS = 15 * 60

export const THREAT_STATUS_LABEL: Record<ThreatStatus, string> = {
  quiet: 'Quiet',
  active: 'Active',
  critical: 'Under active attack',
}

export interface ThreatStatusResult {
  status: ThreatStatus
  recentCount: number
}

export function computeThreatStatus(
  completions: MotifCompletionOut[],
  nowSeconds: number,
  windowSeconds: number = THREAT_STATUS_WINDOW_SECONDS,
): ThreatStatusResult {
  const recentCount = completions.filter((c) => nowSeconds - c.completed_at <= windowSeconds).length
  const status: ThreatStatus =
    recentCount === 0 ? 'quiet' : recentCount <= 2 ? 'active' : 'critical'
  return { status, recentCount }
}

// --- F6.5: active monitoring status --------------------------------------
//
// "Derived the same way as F6.4" (tasks.md) -- from `/api/health`'s
// `last_metrics_snapshot_age_seconds`, i.e. whether the pipeline process
// (`scripts/run_pipeline.py`) appears to still be actively writing, not
// just whether Postgres/Neo4j/Redis themselves are reachable (F6.4's own
// concern). Thresholds are provisional, same caveat as F6.2 above.

export type MonitoringStatus = 'active' | 'stale' | 'inactive'

export const MONITORING_STALE_AFTER_SECONDS = 30
export const MONITORING_INACTIVE_AFTER_SECONDS = 300

export const MONITORING_STATUS_LABEL: Record<MonitoringStatus, string> = {
  active: 'Active',
  stale: 'Stale',
  inactive: 'Inactive',
}

export function computeMonitoringStatus(ageSeconds: number | null): MonitoringStatus {
  if (ageSeconds === null) return 'inactive'
  if (ageSeconds <= MONITORING_STALE_AFTER_SECONDS) return 'active'
  if (ageSeconds <= MONITORING_INACTIVE_AFTER_SECONDS) return 'stale'
  return 'inactive'
}

// --- shared tile-loading convention --------------------------------------
//
// Every tile in this folder treats "query settled with no data" (a 404
// like an empty metrics table, or a genuine fetch failure) the same way:
// F5.3's `StatCard.unavailable` text, using the backend's own error
// message when there is one rather than a generic "something went wrong".

export function tileUnavailableMessage(error: unknown, fallback: string): string {
  return error ? getErrorMessage(error) : fallback
}
