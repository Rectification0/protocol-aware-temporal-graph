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
// F8.1 (Milestone F8) added the shared time-range filter this now reads
// `start`/`end` from, replacing the fixed "last 24h" window this
// originally shipped with -- a fixed bucket *count* (still 24) spread
// evenly across whatever range is selected, so a 7-day selection buckets
// by ~7h instead of trying to render 168 hourly bars. Two series per
// bucket: `attacks` (motif completions whose `completed_at` falls in the
// bucket) and `highRiskEntities` (count of non-benign entity scores --
// reusing the F7.1/F7.3 tiers -- whose *latest* `t` falls in the bucket).
// The latter is an honest snapshot-in-time proxy, not a true history:
// `entity_scores` is upserted/latest-value-only (CLAUDE.md's F0 notes), so
// an entity whose score last updated outside the selected range never
// appears at all, and one that's been high-risk for days only ever shows
// up in whichever single bucket its most recent inference happened to
// land in.

export const THREAT_TREND_BUCKET_COUNT = 24

// A `type` for the same implicit-index-signature reason as
// `SeverityDistributionSlice` above.
export type ThreatTrendPoint = {
  bucketStart: number
  label: string
  attacks: number
  highRiskEntities: number
}

const SHORT_RANGE_LABEL_THRESHOLD_SECONDS = 2 * 24 * 60 * 60

/** Hourly-looking labels read fine for a short (<=2 day) selection, but
 * turn into meaningless repeats once a bucket spans a day or more --
 * switch to a date label once the selected range is that wide. */
function formatBucketLabel(bucketStartSeconds: number, rangeSeconds: number): string {
  const date = new Date(bucketStartSeconds * 1000)
  return rangeSeconds <= SHORT_RANGE_LABEL_THRESHOLD_SECONDS
    ? format(date, 'HH:mm')
    : format(date, 'MMM d')
}

export function buildThreatTrendSeries(
  completions: MotifCompletionOut[],
  scores: EntityScoreOut[],
  start: number,
  end: number,
  bucketCount: number = THREAT_TREND_BUCKET_COUNT,
): ThreatTrendPoint[] {
  const rangeSeconds = Math.max(end - start, 1)
  const bucketSeconds = rangeSeconds / bucketCount
  const buckets: ThreatTrendPoint[] = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = start + index * bucketSeconds
    return {
      bucketStart,
      label: formatBucketLabel(bucketStart, rangeSeconds),
      attacks: 0,
      highRiskEntities: 0,
    }
  })

  // `start`/`end` are inclusive (matching the backend query params of the
  // same name) -- a value exactly at `end` clamps into the last bucket
  // rather than falling one past every bucket's exclusive-upper-bound math.
  function bucketIndexFor(t: number): number | null {
    if (t < start || t > end) return null
    return Math.min(Math.floor((t - start) / bucketSeconds), bucketCount - 1)
  }

  for (const completion of completions) {
    const index = bucketIndexFor(completion.completed_at)
    if (index !== null) buckets[index].attacks += 1
  }
  for (const score of scores) {
    if (classifyEntityScore(score.score) === 'benign') continue
    const index = bucketIndexFor(score.t)
    if (index !== null) buckets[index].highRiskEntities += 1
  }

  return buckets
}

// --- F8.4/F8.5: rate metrics over the selected range ---------------------
//
// Shared by F8.4's threat rate (attacks/hour) and F8.5's average
// anomalies per hour (entity-score volume/hour) -- both are "count of X
// in the selected [start,end] / the range's duration in hours."

const SECONDS_PER_HOUR = 60 * 60

/** `null` for a zero-or-negative-duration range, rather than dividing by
 * zero or returning a misleading `Infinity`. */
export function computeRatePerHour(count: number, start: number, end: number): number | null {
  const hours = (end - start) / SECONDS_PER_HOUR
  return hours > 0 ? count / hours : null
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
