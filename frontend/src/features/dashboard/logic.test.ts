import { describe, expect, it } from 'vitest'
import {
  computeMonitoringStatus,
  computeSecurityLevel,
  computeThreatStatus,
  MONITORING_INACTIVE_AFTER_SECONDS,
  MONITORING_STALE_AFTER_SECONDS,
  SECURITY_LEVEL_THRESHOLDS,
  THREAT_STATUS_WINDOW_SECONDS,
  tileUnavailableMessage,
} from '@/features/dashboard/logic'
import type { MetricsSnapshotOut, MotifCompletionOut } from '@/types/api'

function metrics(hitRatePerSecond: number): MetricsSnapshotOut {
  return {
    active_graph_size: 100,
    prune_rate_per_second: 0,
    epsilon: 0.1,
    motif_hit_rate_per_second: hitRatePerSecond,
    motif_reset_rate_per_second: 0,
    latest_inference_latency_seconds: 0.01,
  }
}

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

describe('computeSecurityLevel', () => {
  it('is normal when both the hit rate and max score are quiet', () => {
    expect(computeSecurityLevel(metrics(0), 0)).toBe('normal')
    expect(computeSecurityLevel(metrics(0), null)).toBe('normal')
  })

  it('escalates on hit rate alone', () => {
    expect(computeSecurityLevel(metrics(0.001), null)).toBe('elevated')
    expect(
      computeSecurityLevel(
        metrics(SECURITY_LEVEL_THRESHOLDS.hitRatePerSecond.critical + 0.01),
        null,
      ),
    ).toBe('critical')
  })

  it('escalates on score magnitude alone', () => {
    expect(
      computeSecurityLevel(metrics(0), SECURITY_LEVEL_THRESHOLDS.maxAbsScore.elevated + 1),
    ).toBe('elevated')
    expect(
      computeSecurityLevel(metrics(0), SECURITY_LEVEL_THRESHOLDS.maxAbsScore.critical + 1),
    ).toBe('critical')
  })

  it('takes the worse of the two signals', () => {
    expect(
      computeSecurityLevel(metrics(0), -(SECURITY_LEVEL_THRESHOLDS.maxAbsScore.critical + 1)),
    ).toBe('critical')
    expect(
      computeSecurityLevel(metrics(SECURITY_LEVEL_THRESHOLDS.hitRatePerSecond.critical + 1), 0),
    ).toBe('critical')
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
