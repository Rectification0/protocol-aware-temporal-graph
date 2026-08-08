import { describe, expect, it } from 'vitest'
import {
  buildSeverityDistribution,
  buildThreatTrendSeries,
  classifyEntityScore,
  computeLiveAttackCount,
  countUserThreatTiers,
  isUserEntity,
  LIVE_ATTACK_WINDOW_SECONDS,
  THREAT_TIER_SCORE_THRESHOLDS,
  THREAT_TREND_BUCKET_COUNT,
  THREAT_TREND_BUCKET_SECONDS,
} from '@/features/analytics/logic'
import type { LiveStreamEvent } from '@/store/liveStreamStore'
import type { EntityScoreOut, MotifCompletionOut } from '@/types/api'

function score(entityId: string, value: number, t = 0): EntityScoreOut {
  return { entity_id: entityId, score: value, t, trigger: 'scheduled', motif_name: null }
}

function completion(completedAt: number): MotifCompletionOut {
  return {
    id: 1,
    motif_name: 'lateral_pivot',
    chain_key: 'Machine:C1',
    matched_edges: ['e1'],
    completed_at: completedAt,
    confidence: 1,
  }
}

function motifCompletionEvent(receivedAt: number): LiveStreamEvent {
  return {
    type: 'motif_completion',
    receivedAt,
    data: {
      id: 1,
      motif_name: 'lateral_pivot',
      chain_key: 'Machine:C1',
      matched_edges: ['e1'],
      completed_at: receivedAt / 1000,
      confidence: 1,
    },
  }
}

describe('classifyEntityScore', () => {
  it('is benign at or below the elevated threshold', () => {
    expect(classifyEntityScore(0)).toBe('benign')
    expect(classifyEntityScore(THREAT_TIER_SCORE_THRESHOLDS.elevated)).toBe('benign')
  })

  it('is suspicious between elevated and critical', () => {
    expect(classifyEntityScore(THREAT_TIER_SCORE_THRESHOLDS.elevated + 0.1)).toBe('suspicious')
    expect(classifyEntityScore(-(THREAT_TIER_SCORE_THRESHOLDS.elevated + 0.1))).toBe('suspicious')
  })

  it('is malicious above the critical threshold, regardless of sign', () => {
    expect(classifyEntityScore(THREAT_TIER_SCORE_THRESHOLDS.critical + 0.1)).toBe('malicious')
    expect(classifyEntityScore(-(THREAT_TIER_SCORE_THRESHOLDS.critical + 0.1))).toBe('malicious')
  })
})

describe('isUserEntity', () => {
  it('recognizes the User: prefix and rejects others', () => {
    expect(isUserEntity('User:alice')).toBe(true)
    expect(isUserEntity('Machine:C1042')).toBe(false)
  })
})

describe('countUserThreatTiers', () => {
  it('tallies only User: entities, ignoring Machine: entities', () => {
    const malicious = THREAT_TIER_SCORE_THRESHOLDS.critical + 1
    const suspicious = THREAT_TIER_SCORE_THRESHOLDS.elevated + 1
    const scores = [
      score('User:alice', malicious),
      score('User:bob', suspicious),
      score('User:carol', 0),
      score('Machine:C1042', malicious),
    ]

    expect(countUserThreatTiers(scores)).toEqual({ malicious: 1, suspicious: 1, benign: 1 })
  })

  it('is all-zero for an empty sample', () => {
    expect(countUserThreatTiers([])).toEqual({ malicious: 0, suspicious: 0, benign: 0 })
  })
})

describe('buildSeverityDistribution', () => {
  it('tallies every entity in the sample, not just users', () => {
    const malicious = THREAT_TIER_SCORE_THRESHOLDS.critical + 1
    const scores = [score('User:alice', malicious), score('Machine:C1042', malicious)]

    const distribution = buildSeverityDistribution(scores)
    expect(distribution).toEqual([
      { tier: 'malicious', label: 'Malicious', count: 2 },
      { tier: 'suspicious', label: 'Suspicious', count: 0 },
      { tier: 'benign', label: 'Benign', count: 0 },
    ])
  })
})

describe('buildThreatTrendSeries', () => {
  const now = THREAT_TREND_BUCKET_SECONDS * THREAT_TREND_BUCKET_COUNT * 10

  it('produces exactly bucketCount buckets covering the trailing window', () => {
    const series = buildThreatTrendSeries([], [], now)
    expect(series).toHaveLength(THREAT_TREND_BUCKET_COUNT)
    expect(series[0].bucketStart).toBe(
      now - THREAT_TREND_BUCKET_SECONDS * THREAT_TREND_BUCKET_COUNT,
    )
    expect(series.every((point) => point.attacks === 0 && point.highRiskEntities === 0)).toBe(true)
  })

  it('buckets motif completions by completed_at', () => {
    const series = buildThreatTrendSeries([completion(now - 1), completion(now - 1)], [], now)
    expect(series[series.length - 1].attacks).toBe(2)
  })

  it('ignores completions and scores outside the visible window', () => {
    const tooOld = now - THREAT_TREND_BUCKET_SECONDS * THREAT_TREND_BUCKET_COUNT - 10
    const malicious = THREAT_TIER_SCORE_THRESHOLDS.critical + 1
    const series = buildThreatTrendSeries(
      [completion(tooOld)],
      [score('User:alice', malicious, tooOld)],
      now,
    )
    expect(series.every((point) => point.attacks === 0 && point.highRiskEntities === 0)).toBe(true)
  })

  it('counts only non-benign scores as high-risk entities', () => {
    const malicious = THREAT_TIER_SCORE_THRESHOLDS.critical + 1
    const series = buildThreatTrendSeries(
      [],
      [score('User:alice', malicious, now - 1), score('User:bob', 0, now - 1)],
      now,
    )
    expect(series[series.length - 1].highRiskEntities).toBe(1)
  })
})

describe('computeLiveAttackCount', () => {
  const anchorMs = 1_000_000

  it('counts motif_completion events within the window', () => {
    const events = [
      motifCompletionEvent(anchorMs),
      motifCompletionEvent(anchorMs - LIVE_ATTACK_WINDOW_SECONDS * 1000 + 1),
    ]
    expect(computeLiveAttackCount(events, anchorMs)).toBe(2)
  })

  it('excludes events outside the window', () => {
    const events = [motifCompletionEvent(anchorMs - LIVE_ATTACK_WINDOW_SECONDS * 1000 - 1)]
    expect(computeLiveAttackCount(events, anchorMs)).toBe(0)
  })

  it('ignores non-motif_completion event types', () => {
    const events: LiveStreamEvent[] = [
      {
        type: 'motif_reset',
        receivedAt: anchorMs,
        data: {
          id: 1,
          motif_name: 'lateral_pivot',
          chain_key: 'Machine:C1',
          triggering_edge_id: 'e1',
          matched_edges: ['e1'],
          reset_at: anchorMs / 1000,
        },
      },
    ]
    expect(computeLiveAttackCount(events, anchorMs)).toBe(0)
  })
})
