import { describe, expect, it } from 'vitest'
import {
  buildAttackFrequencyGrid,
  buildAttackPatternCounts,
  buildDetectionAccuracyRows,
  buildSeverityDistribution,
  buildThreatTrendSeries,
  buildTopTargetedResources,
  classifyEntityScore,
  computeLiveAttackCount,
  computeRatePerHour,
  countUserThreatTiers,
  DAY_OF_WEEK_LABELS,
  HOUR_OF_DAY_LABELS,
  isUserEntity,
  LIVE_ATTACK_WINDOW_SECONDS,
  THREAT_TIER_SCORE_THRESHOLDS,
  THREAT_TREND_BUCKET_COUNT,
} from '@/features/analytics/logic'
import type { LiveStreamEvent } from '@/store/liveStreamStore'
import type { EntityScoreOut, MotifCompletionOut, PilotReportOut } from '@/types/api'

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
  const bucketSeconds = 3600
  const start = bucketSeconds * THREAT_TREND_BUCKET_COUNT * 10
  const end = start + bucketSeconds * THREAT_TREND_BUCKET_COUNT

  it('produces exactly bucketCount buckets spanning [start, end]', () => {
    const series = buildThreatTrendSeries([], [], start, end)
    expect(series).toHaveLength(THREAT_TREND_BUCKET_COUNT)
    expect(series[0].bucketStart).toBe(start)
    expect(series.every((point) => point.attacks === 0 && point.highRiskEntities === 0)).toBe(true)
  })

  it('buckets motif completions by completed_at', () => {
    const series = buildThreatTrendSeries(
      [completion(end - 1), completion(end - 1)],
      [],
      start,
      end,
    )
    expect(series[series.length - 1].attacks).toBe(2)
  })

  it('is inclusive of a completion exactly at the end boundary', () => {
    const series = buildThreatTrendSeries([completion(end)], [], start, end)
    expect(series[series.length - 1].attacks).toBe(1)
  })

  it('ignores completions and scores outside [start, end]', () => {
    const tooOld = start - 10
    const tooNew = end + 10
    const malicious = THREAT_TIER_SCORE_THRESHOLDS.critical + 1
    const series = buildThreatTrendSeries(
      [completion(tooOld), completion(tooNew)],
      [score('User:alice', malicious, tooOld), score('User:bob', malicious, tooNew)],
      start,
      end,
    )
    expect(series.every((point) => point.attacks === 0 && point.highRiskEntities === 0)).toBe(true)
  })

  it('counts only non-benign scores as high-risk entities', () => {
    const malicious = THREAT_TIER_SCORE_THRESHOLDS.critical + 1
    const series = buildThreatTrendSeries(
      [],
      [score('User:alice', malicious, end - 1), score('User:bob', 0, end - 1)],
      start,
      end,
    )
    expect(series[series.length - 1].highRiskEntities).toBe(1)
  })

  it('spreads a wider range across the same fixed bucket count', () => {
    const wideEnd = start + bucketSeconds * THREAT_TREND_BUCKET_COUNT * 7 // a week, not a day
    const series = buildThreatTrendSeries([], [], start, wideEnd)
    expect(series).toHaveLength(THREAT_TREND_BUCKET_COUNT)
    expect(series[1].bucketStart - series[0].bucketStart).toBeCloseTo(
      (wideEnd - start) / THREAT_TREND_BUCKET_COUNT,
    )
  })
})

describe('computeRatePerHour', () => {
  it('divides the count by the range duration in hours', () => {
    expect(computeRatePerHour(10, 0, 2 * 3600)).toBe(5)
  })

  it('returns null for a zero-or-negative-duration range', () => {
    expect(computeRatePerHour(10, 100, 100)).toBeNull()
    expect(computeRatePerHour(10, 200, 100)).toBeNull()
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

// --- F12.3: buildDetectionAccuracyRows ---------------------------------

function pilotReport(overrides: Partial<PilotReportOut> = {}): PilotReportOut {
  return {
    anomaly: {
      true_positives: 3,
      false_positives: 1,
      false_negatives: 0,
      precision: 0.75,
      recall: 1,
    },
    motif: {
      true_positives: 2,
      false_positives: 0,
      false_negatives: 1,
      precision: 1,
      recall: 0.6667,
    },
    evaluated_at: 1000,
    ...overrides,
  }
}

describe('buildDetectionAccuracyRows', () => {
  it('converts every non-null precision/recall into a percentage row', () => {
    const rows = buildDetectionAccuracyRows(pilotReport())
    expect(rows).toEqual([
      { label: 'Anomaly precision', value: 75 },
      { label: 'Anomaly recall', value: 100 },
      { label: 'Motif precision', value: 100 },
      { label: 'Motif recall', value: 66.67 },
    ])
  })

  it('drops a null metric rather than charting it as 0%', () => {
    const rows = buildDetectionAccuracyRows(
      pilotReport({
        anomaly: {
          true_positives: 0,
          false_positives: 0,
          false_negatives: 0,
          precision: null,
          recall: null,
        },
      }),
    )
    expect(rows).toEqual([
      { label: 'Motif precision', value: 100 },
      { label: 'Motif recall', value: 66.67 },
    ])
  })
})

// --- F12.6: buildAttackFrequencyGrid ------------------------------------

describe('buildAttackFrequencyGrid', () => {
  it('produces a 7x24 grid with the correct dimensions', () => {
    const grid = buildAttackFrequencyGrid([], [])
    expect(grid.rowLabels).toEqual([...DAY_OF_WEEK_LABELS])
    expect(grid.columnLabels).toEqual(HOUR_OF_DAY_LABELS)
    expect(grid.values).toHaveLength(7)
    expect(grid.values.every((row) => row.length === 24)).toBe(true)
  })

  it('buckets a motif completion by its UTC day-of-week and hour', () => {
    // 2024-01-01T05:00:00Z is a Monday (index 1).
    const t = Date.UTC(2024, 0, 1, 5) / 1000
    const grid = buildAttackFrequencyGrid([completion(t)], [])
    expect(grid.values[1][5]).toBe(1)
    expect(grid.values.flat().reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('buckets a non-benign score but ignores a benign one', () => {
    const t = Date.UTC(2024, 0, 1, 5) / 1000
    const malicious = THREAT_TIER_SCORE_THRESHOLDS.critical + 1
    const grid = buildAttackFrequencyGrid(
      [],
      [score('User:alice', malicious, t), score('User:bob', 0, t)],
    )
    expect(grid.values[1][5]).toBe(1)
  })
})

// --- F12.7: buildTopTargetedResources ------------------------------------

function completionWith(overrides: Partial<MotifCompletionOut> = {}): MotifCompletionOut {
  return {
    id: 1,
    motif_name: 'lateral_pivot',
    chain_key: 'Machine:C1',
    matched_edges: ['e1'],
    completed_at: 0,
    confidence: 1,
    ...overrides,
  }
}

describe('buildTopTargetedResources', () => {
  it('tallies Machine chain_keys from completions and Machine entity_ids from non-benign scores', () => {
    const malicious = THREAT_TIER_SCORE_THRESHOLDS.critical + 1
    const rows = buildTopTargetedResources(
      [completionWith({ chain_key: 'Machine:C1' }), completionWith({ chain_key: 'Machine:C1' })],
      [score('Machine:C2', malicious), score('User:alice', malicious)],
    )
    expect(rows).toEqual([
      { resource: 'Machine:C1', count: 2 },
      { resource: 'Machine:C2', count: 1 },
    ])
  })

  it('ignores non-Machine chain_keys/entity_ids and benign scores', () => {
    const malicious = THREAT_TIER_SCORE_THRESHOLDS.critical + 1
    const rows = buildTopTargetedResources(
      [completionWith({ chain_key: 'User:service-account' })],
      [score('Machine:C1', 0), score('User:alice', malicious)],
    )
    expect(rows).toEqual([])
  })

  it('sorts descending and respects the limit', () => {
    const rows = buildTopTargetedResources(
      [
        completionWith({ chain_key: 'Machine:C1' }),
        completionWith({ chain_key: 'Machine:C2' }),
        completionWith({ chain_key: 'Machine:C2' }),
      ],
      [],
      1,
    )
    expect(rows).toEqual([{ resource: 'Machine:C2', count: 2 }])
  })
})

// --- F12.8: buildAttackPatternCounts --------------------------------------

describe('buildAttackPatternCounts', () => {
  it('tallies completions by motif_name, sorted descending', () => {
    const rows = buildAttackPatternCounts([
      completionWith({ motif_name: 'lateral_pivot' }),
      completionWith({ motif_name: 'admin_share_escalation' }),
      completionWith({ motif_name: 'lateral_pivot' }),
    ])
    expect(rows).toEqual([
      { motifName: 'lateral_pivot', count: 2 },
      { motifName: 'admin_share_escalation', count: 1 },
    ])
  })

  it('scales to any motif name with no hardcoded list', () => {
    const rows = buildAttackPatternCounts([completionWith({ motif_name: 'some_future_motif' })])
    expect(rows).toEqual([{ motifName: 'some_future_motif', count: 1 }])
  })

  it('returns an empty array for no completions', () => {
    expect(buildAttackPatternCounts([])).toEqual([])
  })
})
