import { describe, expect, it } from 'vitest'
import { useTimeRangeStore } from '@/store/timeRangeStore'

describe('timeRangeStore', () => {
  it('defaults to a 24-hour range ending now', () => {
    const { range } = useTimeRangeStore.getState()
    expect(range.end - range.start).toBeCloseTo(24 * 60 * 60, -1)
    expect(range.end).toBeCloseTo(Date.now() / 1000, -1)
  })

  it('setRange replaces the current range', () => {
    useTimeRangeStore.getState().setRange({ start: 100, end: 200 })
    expect(useTimeRangeStore.getState().range).toEqual({ start: 100, end: 200 })
  })
})
