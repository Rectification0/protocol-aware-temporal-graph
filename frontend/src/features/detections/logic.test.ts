import { describe, expect, it } from 'vitest'
import {
  ANOMALY_SEVERITY_THRESHOLDS,
  buildAnomalyDetectionRows,
  buildDetectionRows,
  buildDispositionsByKey,
  buildMotifDetectionRows,
  EMPTY_DETECTION_FILTERS,
  feedbackKey,
  filterDetectionRows,
  motifDetectionModel,
  severityFromAnomalyScore,
  severityFromMotifConfidence,
  TGNN_DEVIATION_CATEGORY_LABEL,
  TGNN_DEVIATION_MODEL,
  uniqueCategories,
} from '@/features/detections/logic'
import type { EntityScoreOut, MotifCompletionOut, MotifFeedbackOut } from '@/types/api'

function completion(overrides: Partial<MotifCompletionOut> = {}): MotifCompletionOut {
  return {
    id: 1,
    motif_name: 'lateral_pivot',
    chain_key: 'Machine:C1',
    matched_edges: ['e1'],
    completed_at: 100,
    confidence: 1,
    ...overrides,
  }
}

function score(overrides: Partial<EntityScoreOut> = {}): EntityScoreOut {
  return {
    entity_id: 'User:alice',
    score: 0,
    t: 100,
    trigger: 'scheduled',
    motif_name: null,
    ...overrides,
  }
}

function feedback(overrides: Partial<MotifFeedbackOut> = {}): MotifFeedbackOut {
  return {
    id: 1,
    motif_name: 'lateral_pivot',
    chain_key: 'Machine:C1',
    disposition: 'true_positive',
    noted_at: 100,
    analyst: 'alice',
    ...overrides,
  }
}

describe('severityFromMotifConfidence', () => {
  it('is critical at or above 0.9', () => {
    expect(severityFromMotifConfidence(0.9)).toBe('critical')
    expect(severityFromMotifConfidence(1)).toBe('critical')
  })

  it('is high between 0.75 and 0.9', () => {
    expect(severityFromMotifConfidence(0.75)).toBe('high')
    expect(severityFromMotifConfidence(0.89)).toBe('high')
  })

  it('is never below medium, even for a low-confidence fuzzy match', () => {
    expect(severityFromMotifConfidence(0.1)).toBe('medium')
    expect(severityFromMotifConfidence(0.01)).toBe('medium')
  })
})

describe('severityFromAnomalyScore', () => {
  const { low, medium, high, critical } = ANOMALY_SEVERITY_THRESHOLDS

  it('is info at or below the low threshold (benign, in F7.1 terms)', () => {
    expect(severityFromAnomalyScore(0)).toBe('info')
    expect(severityFromAnomalyScore(low)).toBe('info')
    expect(severityFromAnomalyScore(-low)).toBe('info')
  })

  it('ranks low/medium/high/critical strictly above the low threshold', () => {
    expect(severityFromAnomalyScore(low + 0.1)).toBe('low')
    expect(severityFromAnomalyScore(medium + 0.1)).toBe('medium')
    expect(severityFromAnomalyScore(high + 0.1)).toBe('high')
    expect(severityFromAnomalyScore(critical + 0.1)).toBe('critical')
  })

  it('classifies by magnitude regardless of sign', () => {
    expect(severityFromAnomalyScore(-(critical + 1))).toBe('critical')
  })
})

describe('motifDetectionModel', () => {
  it('prefixes with motif:', () => {
    expect(motifDetectionModel('lateral_pivot')).toBe('motif:lateral_pivot')
  })
})

describe('buildDispositionsByKey', () => {
  it('keys on motif_name + chain_key', () => {
    const map = buildDispositionsByKey([feedback()])
    expect(map.get(feedbackKey('lateral_pivot', 'Machine:C1'))).toBe('true_positive')
  })

  it('the newest (first, per DESC ordering) entry per key wins', () => {
    const map = buildDispositionsByKey([
      feedback({ id: 2, disposition: 'false_positive', noted_at: 200 }),
      feedback({ id: 1, disposition: 'true_positive', noted_at: 100 }),
    ])
    expect(map.get(feedbackKey('lateral_pivot', 'Machine:C1'))).toBe('false_positive')
  })
})

describe('buildMotifDetectionRows', () => {
  it('maps confidence/motif_name/completed_at/chain_key onto the row per F9.2', () => {
    const [row] = buildMotifDetectionRows([completion()], new Map())
    expect(row).toMatchObject({
      path: 'motif',
      confidence: 1,
      category: 'lateral_pivot',
      model: 'motif:lateral_pivot',
      timestamp: 100,
      source: 'Machine:C1',
      disposition: 'unconfirmed',
      motifName: 'lateral_pivot',
      chainKey: 'Machine:C1',
    })
  })

  it('looks up a real disposition when feedback exists for the key', () => {
    const dispositions = buildDispositionsByKey([feedback({ disposition: 'false_positive' })])
    const [row] = buildMotifDetectionRows([completion()], dispositions)
    expect(row.disposition).toBe('false_positive')
  })
})

describe('buildAnomalyDetectionRows', () => {
  it('excludes motif_completion-triggered rescoring (already listed via F9.2)', () => {
    const rows = buildAnomalyDetectionRows([
      score({ trigger: 'motif_completion', score: ANOMALY_SEVERITY_THRESHOLDS.critical + 1 }),
    ])
    expect(rows).toHaveLength(0)
  })

  it('excludes scheduled scores at or below the non-benign bar', () => {
    const rows = buildAnomalyDetectionRows([
      score({ trigger: 'scheduled', score: ANOMALY_SEVERITY_THRESHOLDS.low }),
    ])
    expect(rows).toHaveLength(0)
  })

  it('includes a scheduled score above the bar, with no confidence/feedback concept', () => {
    const [row] = buildAnomalyDetectionRows([
      score({ trigger: 'scheduled', score: ANOMALY_SEVERITY_THRESHOLDS.critical + 1 }),
    ])
    expect(row).toMatchObject({
      path: 'anomaly',
      confidence: null,
      category: TGNN_DEVIATION_CATEGORY_LABEL,
      model: TGNN_DEVIATION_MODEL,
      disposition: 'unconfirmed',
    })
  })
})

describe('buildDetectionRows', () => {
  it('merges both paths and sorts newest-first', () => {
    const rows = buildDetectionRows(
      [completion({ id: 1, completed_at: 100 })],
      [score({ trigger: 'scheduled', score: ANOMALY_SEVERITY_THRESHOLDS.critical + 1, t: 200 })],
      [],
    )
    expect(rows.map((r) => r.timestamp)).toEqual([200, 100])
  })
})

describe('uniqueCategories', () => {
  it('deduplicates and sorts', () => {
    const rows = buildDetectionRows(
      [
        completion({ id: 1, motif_name: 'lateral_pivot' }),
        completion({ id: 2, motif_name: 'admin_share_escalation' }),
      ],
      [],
      [],
    )
    expect(uniqueCategories(rows)).toEqual(['admin_share_escalation', 'lateral_pivot'])
  })
})

describe('filterDetectionRows', () => {
  const rows = buildDetectionRows(
    [completion({ id: 1, motif_name: 'lateral_pivot', confidence: 1 })],
    [
      score({
        trigger: 'scheduled',
        score: ANOMALY_SEVERITY_THRESHOLDS.critical + 1,
        entity_id: 'User:bob',
      }),
    ],
    [],
  )

  it('returns everything when no filter is set', () => {
    expect(filterDetectionRows(rows, EMPTY_DETECTION_FILTERS)).toHaveLength(2)
  })

  it('filters by severity', () => {
    const filtered = filterDetectionRows(rows, { ...EMPTY_DETECTION_FILTERS, severity: 'critical' })
    expect(filtered.every((r) => r.severity === 'critical')).toBe(true)
    expect(filtered).toHaveLength(2) // motif confidence=1 -> critical, anomaly score well above critical -> critical
  })

  it('filters by category', () => {
    const filtered = filterDetectionRows(rows, {
      ...EMPTY_DETECTION_FILTERS,
      category: TGNN_DEVIATION_CATEGORY_LABEL,
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].path).toBe('anomaly')
  })

  it('filters by disposition', () => {
    const filtered = filterDetectionRows(rows, {
      ...EMPTY_DETECTION_FILTERS,
      disposition: 'unconfirmed',
    })
    expect(filtered).toHaveLength(2)
    const filteredTp = filterDetectionRows(rows, {
      ...EMPTY_DETECTION_FILTERS,
      disposition: 'true_positive',
    })
    expect(filteredTp).toHaveLength(0)
  })
})
