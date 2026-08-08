import { describe, expect, it } from 'vitest'
import {
  formatHalfLife,
  formatLambda,
  formatMotifSteps,
  formatWindowSeconds,
} from '@/features/settings/logic'

describe('formatHalfLife', () => {
  it('renders n/a for a null half-life', () => {
    expect(formatHalfLife(null)).toBe('n/a')
  })

  it('renders hours for values >= 1', () => {
    expect(formatHalfLife(12.34)).toBe('12.3h')
  })

  it('renders minutes for sub-hour values', () => {
    expect(formatHalfLife(0.5)).toBe('30m')
  })
})

describe('formatLambda', () => {
  it('renders four decimal places', () => {
    expect(formatLambda(0.0001)).toBe('0.0001')
  })
})

describe('formatWindowSeconds', () => {
  it('renders seconds under a minute', () => {
    expect(formatWindowSeconds(45)).toBe('45s')
  })

  it('renders minutes at or above 60s', () => {
    expect(formatWindowSeconds(300)).toBe('5m')
  })
})

describe('formatMotifSteps', () => {
  it('pluralizes correctly', () => {
    expect(formatMotifSteps(1)).toBe('1 step')
    expect(formatMotifSteps(2)).toBe('2 steps')
  })
})
