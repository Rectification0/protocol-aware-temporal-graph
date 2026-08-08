import { format } from 'date-fns'
import { SECURITY_LEVEL_THRESHOLDS } from '@/features/dashboard/logic'
import type { LiveStreamEvent } from '@/store/liveStreamStore'
import type { EntityScoreOut, MotifCompletionOut } from '@/types/api'

// F7 (Threat Analytics). Pure/testable derivations live here, same split
// `features/dashboard/logic.ts` established for F6 -- the components in
// this folder just wire a hook's result through one of these and render
// the result via F5.3's `StatCard`/F5.5's chart wrappers.

// --- F7.1/F7.3: score-magnitude threat tiers -----------------------------
//
// tasks.md's F7.1 line is explicit that there is no persisted per-user
// classification today, and that any threshold bucketing here is
// provisional given the untrained reference model (specs.md §4). Rather
// than inventing a second set of illustrative magic numbers, this reuses
// F6.2's exact `maxAbsScore` thresholds (`elevated`/`critical`) under new
// names (`suspicious`/`malicious`) -- the same interim proxy, applied to
// individual entities instead of "the single worst entity."

export type ThreatTier = 'benign' | 'suspicious' | 'malicious'

export const THREAT_TIER_SCORE_THRESHOLDS = SECURITY_LEVEL_THRESHOLDS.maxAbsScore

export const THREAT_TIER_LABEL: Record<ThreatTier, string> = {
  benign: 'Benign',
  suspicious: 'Suspicious',
  malicious: 'Malicious',
}

/** `score` is the raw (possibly negative) `EntityScoreOut.score` -- the
 * sign carries no fixed meaning (specs.md §4), so this classifies on
 * magnitude alone. */
export function classifyEntityScore(score: number): ThreatTier {
  const magnitude = Math.abs(score)
  if (magnitude > THREAT_TIER_SCORE_THRESHOLDS.critical) return 'malicious'
  if (magnitude > THREAT_TIER_SCORE_THRESHOLDS.elevated) return 'suspicious'
  return 'benign'
}

const USER_ENTITY_PREFIX = 'User:'

/** Node ids are `"<Type>:<name>"` (schema.py's `Edge.__post_init__`) --
 * `EntityScoreOut.entity_id` carries the same shape. */
export function isUserEntity(entityId: string): boolean {
  return entityId.startsWith(USER_ENTITY_PREFIX)
}

export interface ThreatTierCounts {
  benign: number
  suspicious: number
  malicious: number
}

function tallyThreatTiers(scores: EntityScoreOut[]): ThreatTierCounts {
  const counts: ThreatTierCounts = { benign: 0, suspicious: 0, malicious: 0 }
  for (const s of scores) {
    counts[classifyEntityScore(s.score)] += 1
  }
  return counts
}

/** F7.1: malicious/suspicious/benign counts, restricted to `User:*`
 * entities per tasks.md's "user counts" wording. */
export function countUserThreatTiers(scores: EntityScoreOut[]): ThreatTierCounts {
  return tallyThreatTiers(scores.filter((s) => isUserEntity(s.entity_id)))
}

// A `type` (not `interface`) -- only object-literal type aliases get TS's
// implicit index signature, which `TimeSeriesChart`/`DonutChart`'s
// `T extends Record<string, unknown>` constraint (charts.tsx) needs.
export type SeverityDistributionSlice = {
  tier: ThreatTier
  label: string
  count: number
}

/** F7.3: severity distribution across every entity in the sample (Users
 * and Machines alike) -- "bucketed the same way as F7.1" per tasks.md,
 * but over the broader population rather than users only. */
export function buildSeverityDistribution(scores: EntityScoreOut[]): SeverityDistributionSlice[] {
  const counts = tallyThreatTiers(scores)
  return (['malicious', 'suspicious', 'benign'] as const).map((tier) => ({
    tier,
    label: THREAT_TIER_LABEL[tier],
    count: counts[tier],
  }))
}

// --- F7.2: threat trends over time ---------------------------------------
//
// F8.1's real time-range control doesn't exist yet -- fixed at the last
// 24 hours in hourly buckets, a provisional window in the same spirit as
// F6.3's `THREAT_STATUS_WINDOW_SECONDS`. Two series per bucket: `attacks`
// (motif completions whose `completed_at` falls in the bucket) and
// `highRiskEntities` (count of non-benign entity scores -- reusing the
// F7.1/F7.3 tiers -- whose *latest* `t` falls in the bucket). The latter
// is an honest snapshot-in-time proxy, not a true history: `entity_scores`
// is upserted/latest-value-only (CLAUDE.md's F0 notes), so an entity whose
// score last updated outside the visible sample never appears at all, and
// one that's been high-risk for days only ever shows up in whichever
// single bucket its most recent inference happened to land in.

export const THREAT_TREND_BUCKET_SECONDS = 60 * 60
export const THREAT_TREND_BUCKET_COUNT = 24

// A `type` for the same implicit-index-signature reason as
// `SeverityDistributionSlice` above.
export type ThreatTrendPoint = {
  bucketStart: number
  label: string
  attacks: number
  highRiskEntities: number
}

export function buildThreatTrendSeries(
  completions: MotifCompletionOut[],
  scores: EntityScoreOut[],
  nowSeconds: number,
  bucketSeconds: number = THREAT_TREND_BUCKET_SECONDS,
  bucketCount: number = THREAT_TREND_BUCKET_COUNT,
): ThreatTrendPoint[] {
  const windowStart = nowSeconds - bucketSeconds * bucketCount
  const buckets: ThreatTrendPoint[] = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = windowStart + index * bucketSeconds
    return {
      bucketStart,
      label: format(new Date(bucketStart * 1000), 'HH:mm'),
      attacks: 0,
      highRiskEntities: 0,
    }
  })

  const bucketIndexFor = (t: number) => Math.floor((t - windowStart) / bucketSeconds)

  for (const completion of completions) {
    const index = bucketIndexFor(completion.completed_at)
    if (index >= 0 && index < bucketCount) buckets[index].attacks += 1
  }
  for (const score of scores) {
    if (classifyEntityScore(score.score) === 'benign') continue
    const index = bucketIndexFor(score.t)
    if (index >= 0 && index < bucketCount) buckets[index].highRiskEntities += 1
  }

  return buckets
}

// --- F7.4: live attack counter --------------------------------------------
//
// Counts `motif_completion` events already sitting in F4.6's live-event
// store (`useLiveStreamStore`) within a rolling window. The caller anchors
// this to the stream's own `lastHeartbeatAt` rather than a live
// `Date.now()` read during render (same purity reasoning as F6.3/F6.6's
// `dataUpdatedAt` anchoring) -- while the stream has never delivered a
// heartbeat yet, there's no safe anchor and the component should show its
// loading/unavailable state instead of guessing with the wall clock.

export const LIVE_ATTACK_WINDOW_SECONDS = 5 * 60

export function computeLiveAttackCount(
  events: LiveStreamEvent[],
  anchorMs: number,
  windowSeconds: number = LIVE_ATTACK_WINDOW_SECONDS,
): number {
  return events.filter(
    (event) =>
      event.type === 'motif_completion' && (anchorMs - event.receivedAt) / 1000 <= windowSeconds,
  ).length
}
