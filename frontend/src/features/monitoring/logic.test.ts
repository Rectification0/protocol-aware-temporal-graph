import { describe, expect, it } from 'vitest'
import {
  ackKey,
  ALERT_SEVERITIES,
  connectionStatusTone,
  countUnreadAlerts,
  countUnreadEnabledAlerts,
  detectionRefFor,
  eventSeverity,
  eventTypeLabel,
  filterAlertEvents,
  filterCriticalEvents,
  filterEnabledAlertEvents,
  isAlertEvent,
  isEnabledAlertEvent,
  summarizeLiveEvent,
} from '@/features/monitoring/logic'
import { ANOMALY_SEVERITY_THRESHOLDS } from '@/features/detections/logic'
import type { LiveStreamEvent } from '@/store/liveStreamStore'

function motifCompletionEvent(
  overrides: { receivedAt?: number; confidence?: number } = {},
): LiveStreamEvent {
  return {
    type: 'motif_completion',
    receivedAt: overrides.receivedAt ?? 1000,
    data: {
      id: 1,
      motif_name: 'lateral_pivot',
      chain_key: 'Machine:C1',
      matched_edges: ['e1'],
      completed_at: 100,
      confidence: overrides.confidence ?? 1,
    },
  }
}

function motifResetEvent(receivedAt = 1000): LiveStreamEvent {
  return {
    type: 'motif_reset',
    receivedAt,
    data: {
      id: 1,
      motif_name: 'lateral_pivot',
      chain_key: 'Machine:C1',
      triggering_edge_id: 'e1',
      matched_edges: ['e1'],
      reset_at: 100,
    },
  }
}

function inferenceResultEvent(
  overrides: { receivedAt?: number; score?: number } = {},
): LiveStreamEvent {
  return {
    type: 'inference_result',
    receivedAt: overrides.receivedAt ?? 1000,
    data: {
      entity_id: 'User:alice',
      score: overrides.score ?? 0,
      t: 100,
      trigger: 'scheduled',
      motif_name: null,
    },
  }
}

function pruneEvent(receivedAt = 1000): LiveStreamEvent {
  return {
    type: 'prune',
    receivedAt,
    data: {
      type: 'prune',
      edge_id: 'e1',
      src: 'User:alice',
      dst: 'Machine:C1',
      edge_type: 'Authentication',
      protocol: 'RDP',
      w_at_prune: 0.1,
      pruned_at: 100,
      logged_at: 100,
    },
  }
}

const CRITICAL_SCORE = ANOMALY_SEVERITY_THRESHOLDS.critical + 1
const LOW_SCORE = ANOMALY_SEVERITY_THRESHOLDS.low - 0.01

describe('eventSeverity', () => {
  it('is never null for a motif completion, even a low-confidence one', () => {
    expect(eventSeverity(motifCompletionEvent({ confidence: 0.5 }))).toBe('medium')
    expect(eventSeverity(motifCompletionEvent({ confidence: 1 }))).toBe('critical')
  })

  it('is null for a benign (below-threshold) inference result', () => {
    expect(eventSeverity(inferenceResultEvent({ score: LOW_SCORE }))).toBeNull()
  })

  it('is a real severity for a non-benign inference result', () => {
    expect(eventSeverity(inferenceResultEvent({ score: CRITICAL_SCORE }))).toBe('critical')
  })

  it('is null for motif_reset and prune -- operational events, not detections', () => {
    expect(eventSeverity(motifResetEvent())).toBeNull()
    expect(eventSeverity(pruneEvent())).toBeNull()
  })
})

describe('isAlertEvent / filterAlertEvents', () => {
  it('counts motif completions and non-benign scores as alerts, nothing else', () => {
    const events = [
      motifCompletionEvent(),
      inferenceResultEvent({ score: CRITICAL_SCORE }),
      inferenceResultEvent({ score: LOW_SCORE }),
      motifResetEvent(),
      pruneEvent(),
    ]
    expect(events.map(isAlertEvent)).toEqual([true, true, false, false, false])
    expect(filterAlertEvents(events)).toHaveLength(2)
  })
})

describe('countUnreadAlerts', () => {
  it('counts only alert events newer than lastReadAt', () => {
    const events = [
      motifCompletionEvent({ receivedAt: 2000 }),
      motifCompletionEvent({ receivedAt: 500 }),
      motifResetEvent(2000), // not an alert at all
    ]
    expect(countUnreadAlerts(events, 1000)).toBe(1)
  })
})

describe('isEnabledAlertEvent / filterEnabledAlertEvents / countUnreadEnabledAlerts (F15.2)', () => {
  const events = [
    motifCompletionEvent({ confidence: 1, receivedAt: 2000 }), // critical
    motifCompletionEvent({ confidence: 0.5, receivedAt: 500 }), // medium
    inferenceResultEvent({ score: LOW_SCORE, receivedAt: 2000 }), // benign, never an alert
  ]

  it('with every severity enabled, matches filterAlertEvents/countUnreadAlerts exactly', () => {
    expect(filterEnabledAlertEvents(events, ALERT_SEVERITIES)).toEqual(filterAlertEvents(events))
    expect(countUnreadEnabledAlerts(events, 1000, ALERT_SEVERITIES)).toBe(
      countUnreadAlerts(events, 1000),
    )
  })

  it('excludes a severity the caller disabled', () => {
    const criticalOnly = ALERT_SEVERITIES.filter((s) => s !== 'medium')
    expect(filterEnabledAlertEvents(events, criticalOnly)).toHaveLength(1)
    expect(isEnabledAlertEvent(events[1], criticalOnly)).toBe(false)
  })

  it('accepts a Set as well as an array', () => {
    const criticalOnly = new Set<(typeof ALERT_SEVERITIES)[number]>(['critical'])
    expect(filterEnabledAlertEvents(events, criticalOnly)).toHaveLength(1)
  })

  it('never enables a benign event regardless of the allowlist', () => {
    expect(isEnabledAlertEvent(events[2], ALERT_SEVERITIES)).toBe(false)
  })
})

describe('filterCriticalEvents', () => {
  it('keeps only critical-severity events', () => {
    const events = [
      motifCompletionEvent({ confidence: 1 }), // critical
      motifCompletionEvent({ confidence: 0.5 }), // medium
      inferenceResultEvent({ score: CRITICAL_SCORE }),
      inferenceResultEvent({ score: LOW_SCORE }),
    ]
    expect(filterCriticalEvents(events)).toHaveLength(2)
  })
})

describe('eventTypeLabel', () => {
  it('has a human label for every event type', () => {
    expect(eventTypeLabel('motif_completion')).toBe('Motif completion')
    expect(eventTypeLabel('motif_reset')).toBe('Motif reset')
    expect(eventTypeLabel('inference_result')).toBe('Score update')
    expect(eventTypeLabel('prune')).toBe('Prune')
  })
})

describe('summarizeLiveEvent', () => {
  it('summarizes every event type', () => {
    expect(summarizeLiveEvent(motifCompletionEvent())).toBe(
      'lateral_pivot completed (chain Machine:C1)',
    )
    expect(summarizeLiveEvent(motifResetEvent())).toBe('lateral_pivot reset (chain Machine:C1)')
    expect(summarizeLiveEvent(inferenceResultEvent({ score: 1.5 }))).toBe('User:alice scored 1.50')
    expect(summarizeLiveEvent(pruneEvent())).toBe('Pruned Authentication: User:alice -> Machine:C1')
  })
})

describe('detectionRefFor', () => {
  it('builds the motif_completion ref matching the alerts.py-documented shape', () => {
    expect(detectionRefFor(motifCompletionEvent())).toEqual({
      detectionType: 'motif_completion',
      detectionRef: 'lateral_pivot:Machine:C1:100',
    })
  })

  it('builds the anomaly ref matching the alerts.py-documented shape', () => {
    expect(detectionRefFor(inferenceResultEvent())).toEqual({
      detectionType: 'anomaly',
      detectionRef: 'User:alice:100',
    })
  })

  it('returns null for non-detection event types', () => {
    expect(detectionRefFor(motifResetEvent())).toBeNull()
    expect(detectionRefFor(pruneEvent())).toBeNull()
  })
})

describe('ackKey', () => {
  it('joins type and ref', () => {
    expect(ackKey('anomaly', 'User:alice:100')).toBe('anomaly:User:alice:100')
  })
})

describe('connectionStatusTone', () => {
  it('maps every LiveStreamStatus to a tone', () => {
    expect(connectionStatusTone('open')).toBe('success')
    expect(connectionStatusTone('connecting')).toBe('warning')
    expect(connectionStatusTone('reconnecting')).toBe('warning')
    expect(connectionStatusTone('closed')).toBe('neutral')
    expect(connectionStatusTone('idle')).toBe('neutral')
  })
})
