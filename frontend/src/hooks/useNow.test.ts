import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNow } from '@/hooks/useNow'
import { liveEventKey, type LiveStreamEvent } from '@/store/liveStreamStore'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useNow (F16.6)', () => {
  it('re-renders subscribers every 15s with the current time', () => {
    vi.setSystemTime(1_000_000)
    const { result } = renderHook(() => useNow())
    expect(result.current).toBe(1_000_000)

    act(() => {
      vi.advanceTimersByTime(15_000)
    })

    expect(result.current).toBe(1_015_000)
  })

  it('runs one interval for all subscribers and stops it when the last unmounts', () => {
    const a = renderHook(() => useNow())
    const b = renderHook(() => useNow())
    expect(vi.getTimerCount()).toBe(1)

    a.unmount()
    expect(vi.getTimerCount()).toBe(1)
    b.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('liveEventKey (F16.6)', () => {
  it('is stable per event object and unique across equal-looking events', () => {
    const make = (): LiveStreamEvent => ({
      type: 'prune',
      data: { type: 'prune', logged_at: 1 },
      receivedAt: 5,
    })
    const first = make()
    const twin = make()

    expect(liveEventKey(first)).toBe(liveEventKey(first))
    expect(liveEventKey(first)).not.toBe(liveEventKey(twin))
  })
})
