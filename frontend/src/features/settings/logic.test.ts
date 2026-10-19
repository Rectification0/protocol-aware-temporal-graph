import { describe, expect, it } from 'vitest'
import {
  describeConfigChange,
  formatHalfLife,
  formatLambda,
  formatMotifSteps,
  formatWindowSeconds,
  halfLifeHoursToLambda,
  lambdaToHalfLifeHours,
  validateHalfLifeInput,
  validateWindowMinutesInput,
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
  it('uses scientific notation so small real values stay visible', () => {
    expect(formatLambda(0.0001925)).toBe('1.925e-4')
    // DNS's actual value -- the old toFixed(4) printed this as "0.0000".
    expect(formatLambda(0.000001)).toBe('1.000e-6')
  })
})

describe('FB.1 threshold editing helpers', () => {
  const bounds = {
    min_lambda_p: Math.log(2) / (365 * 24 * 3600),
    max_lambda_p: Math.log(2) / 60,
    min_window_seconds: 60,
    max_window_seconds: 30 * 24 * 3600,
  }

  it('converts between half-life hours and lambda_p', () => {
    expect(halfLifeHoursToLambda(1)).toBeCloseTo(0.0001925, 7)
    expect(lambdaToHalfLifeHours(halfLifeHoursToLambda(48))).toBeCloseTo(48, 10)
  })

  it('validates a half-life against the API bounds', () => {
    expect(validateHalfLifeInput('48', bounds)).toBeNull()
    expect(validateHalfLifeInput('', bounds)).toMatch(/Enter a number/)
    expect(validateHalfLifeInput('abc', bounds)).toMatch(/Enter a number/)
    expect(validateHalfLifeInput('-2', bounds)).toMatch(/positive/)
    expect(validateHalfLifeInput('0.001', bounds)).toMatch(/between 1 minute and 365 days/)
    expect(validateHalfLifeInput('9000', bounds)).toMatch(/between/)
  })

  it('validates a window in minutes against the API bounds', () => {
    expect(validateWindowMinutesInput('120', bounds)).toBeNull()
    expect(validateWindowMinutesInput('1.5', bounds)).toBeNull()
    expect(validateWindowMinutesInput('0.5', bounds)).toMatch(/between 1 and 43200 minutes/)
    expect(validateWindowMinutesInput('1.001', bounds)).toMatch(/whole number of seconds/)
    expect(validateWindowMinutesInput('x', bounds)).toMatch(/Enter a number/)
  })

  it('describes audited changes in the units the UI edits them in', () => {
    expect(
      describeConfigChange({
        kind: 'protocol',
        target: 'SMB',
        old_value: halfLifeHoursToLambda(48),
        new_value: halfLifeHoursToLambda(12),
      }),
    ).toBe('SMB half-life 48.0h -> 12.0h')
    expect(
      describeConfigChange({
        kind: 'motif',
        target: 'lateral_pivot',
        old_value: 14400,
        new_value: 7200,
      }),
    ).toBe('lateral_pivot window 240m -> 120m')
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
