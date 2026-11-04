import { describe, expect, it } from 'vitest'
import {
  computeMonitoringStatus,
  computeThreatStatus,
  formatPenalty,
  MONITORING_INACTIVE_AFTER_SECONDS,
  MONITORING_STALE_AFTER_SECONDS,
  SECURITY_LEVEL_THRESHOLDS,
  securityScoreUnavailable,
  THREAT_STATUS_WINDOW_SECONDS,
  tileUnavailableMessage,
} from '@/features/dashboard/logic'
import { securityScoreFixture } from '@/test/securityScore'
import type { MotifCompletionOut } from '@/types/api'

function completion(completedAt: number): MotifCompletionOut {
  return {
    id: 1,
    motif_name: 'lateral_pivot',
    chain_key: 'Machine:C1',
    matched_edges: ['e1', 'e2'],
    completed_at: completedAt,
    confidence: 1,
  }
}

describe('securityScoreUnavailable', () => {
  it('is undefined when there is a score', () => {
    expect(securityScoreUnavailable(securityScoreFixture(), null)).toBeUndefined()
  })

  it('uses the reason the backend gives when it withholds the score', () => {
    const withheld = securityScoreFixture({ score: null, band: null, unavailable_reason: 'stale' })
    expect(securityScoreUnavailable(withheld, null)).toBe('stale')
  })

  it('falls back to the fetch error', () => {
    expect(securityScoreUnavailable(undefined, new Error('boom'))).toBe('boom')
    expect(securityScoreUnavailable(undefined, null)).toBe('Score unavailable')
  })
})

describe('formatPenalty', () => {
  it('shows at most one decimal and drops a trailing .0', () => {
    expect(formatPenalty(15.74)).toBe('15.7')
    expect(formatPenalty(5)).toBe('5')
    expect(formatPenalty(0.04)).toBe('0')
  })
})

describe('SECURITY_LEVEL_THRESHOLDS', () => {
  it('keeps critical at 6, the anomaly threshold in security_score.py', () => {
    expect(SECURITY_LEVEL_THRESHOLDS.maxAbsScore.critical).toBe(6)
  })
})

describe('computeThreatStatus', () => {
  const now = 1_000_000

  it('is quiet with no recent completions', () => {
    expect(computeThreatStatus([], now)).toEqual({ status: 'quiet', recentCount: 0 })
    expect(computeThreatStatus([completion(now - THREAT_STATUS_WINDOW_SECONDS - 1)], now)).toEqual({
      status: 'quiet',
      recentCount: 0,
    })
  })

  it('counts only completions within the window', () => {
    const completions = [completion(now - 10), completion(now - THREAT_STATUS_WINDOW_SECONDS - 1)]
    expect(computeThreatStatus(completions, now)).toEqual({ status: 'active', recentCount: 1 })
  })

  it('escalates to critical past 2 recent completions', () => {
    const completions = [completion(now), completion(now - 1), completion(now - 2)]
    expect(computeThreatStatus(completions, now)).toEqual({ status: 'critical', recentCount: 3 })
  })
})

describe('computeMonitoringStatus', () => {
  it('is inactive when age is unknown', () => {
    expect(computeMonitoringStatus(null)).toBe('inactive')
  })

  it('thresholds active/stale/inactive at the documented boundaries', () => {
    expect(computeMonitoringStatus(MONITORING_STALE_AFTER_SECONDS)).toBe('active')
    expect(computeMonitoringStatus(MONITORING_STALE_AFTER_SECONDS + 1)).toBe('stale')
    expect(computeMonitoringStatus(MONITORING_INACTIVE_AFTER_SECONDS)).toBe('stale')
    expect(computeMonitoringStatus(MONITORING_INACTIVE_AFTER_SECONDS + 1)).toBe('inactive')
  })
})

describe('tileUnavailableMessage', () => {
  it('prefers the error message when present', () => {
    expect(tileUnavailableMessage(new Error('boom'), 'fallback')).toBe('boom')
  })

  it('falls back when there is no error', () => {
    expect(tileUnavailableMessage(undefined, 'fallback')).toBe('fallback')
  })
})
