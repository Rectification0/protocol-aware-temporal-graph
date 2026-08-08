import { describe, expect, it } from 'vitest'
import { formatDurationSeconds } from '@/features/security-overview/logic'

describe('formatDurationSeconds', () => {
  it('formats sub-minute durations as seconds', () => {
    expect(formatDurationSeconds(0)).toBe('0s')
    expect(formatDurationSeconds(45)).toBe('45s')
  })

  it('formats sub-hour durations as minutes and seconds', () => {
    expect(formatDurationSeconds(90)).toBe('1m 30s')
    expect(formatDurationSeconds(120)).toBe('2m')
  })

  it('formats durations over an hour as hours and minutes', () => {
    expect(formatDurationSeconds(3661)).toBe('1h 1m')
    expect(formatDurationSeconds(7200)).toBe('2h')
  })

  it('rounds to the nearest second', () => {
    expect(formatDurationSeconds(45.6)).toBe('46s')
  })

  it('clamps a negative duration to 0 rather than showing a negative sign', () => {
    expect(formatDurationSeconds(-5)).toBe('0s')
  })
})
