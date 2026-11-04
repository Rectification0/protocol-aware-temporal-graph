import { getErrorMessage } from '@/api/client'
import type { StatusTone } from '@/features/dashboard/status-pill'
import type { MotifCompletionOut, SecurityScoreBand, SecurityScoreOut } from '@/types/api'

// F6's executive-dashboard tiles. Pure/testable derivations live here;
// the tile components (this folder) just wire a hook's result through
// one of these and render the result via F5.3's `StatCard`.

// --- F6.1/F6.2: company cybersecurity score (F0.12) --------------------
//
// The score and its band come from the backend (`security_score.py`, GET
// /api/security/score): the formula is defined there, once, so these tiles
// only present it. F6.2's "security level" used to be an interim proxy
// (thresholded motif hit rate and top entity |score|); since F0.12 it is
// the score's band, so the two tiles can't disagree.

/** |score| magnitudes for the untrained T-GNN's provisional tiers.
 * `critical` is also `security_score.py`'s ANOMALY_SCORE_THRESHOLD (the
 * score's anomalous-entity cutoff): keep the two in step. Reused by F7.1
 * (`classifyEntityScore`) and F9 (anomaly-path severity). Illustrative,
 * not calibrated (specs.md §4). */
export const SECURITY_LEVEL_THRESHOLDS = {
  maxAbsScore: { elevated: 3, critical: 6 },
} as const

export const SECURITY_SCORE_BAND_LABEL: Record<SecurityScoreBand, string> = {
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  critical: 'Critical',
}

export const SECURITY_SCORE_BAND_TONE: Record<SecurityScoreBand, StatusTone> = {
  good: 'success',
  fair: 'warning',
  poor: 'error',
  critical: 'error',
}

/** The tile's message when there's no score to show: the backend's own
 * reason when it withheld the score (pipeline not reporting), else the
 * fetch error. */
export function securityScoreUnavailable(
  data: SecurityScoreOut | undefined,
  error: unknown,
): string | undefined {
  if (data)
    return data.score === null ? (data.unavailable_reason ?? 'Score unavailable') : undefined
  return tileUnavailableMessage(error, 'Score unavailable')
}

/** Penalty points as a whole-number-or-one-decimal string ("12.3", "0"). */
export function formatPenalty(points: number): string {
  const rounded = Math.round(points * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
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
