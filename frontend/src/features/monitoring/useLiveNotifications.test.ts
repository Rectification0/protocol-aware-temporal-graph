import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveStreamStore } from '@/store/liveStreamStore'

const toastMock = vi.fn()
vi.mock('@/components/toast', () => ({ toast: toastMock }))

const { useLiveNotifications } = await import('@/features/monitoring/useLiveNotifications')

function pushCompletion(receivedAt: number) {
  useLiveStreamStore.getState().pushEvent({
    type: 'motif_completion',
    receivedAt,
    data: {
      id: 1,
      motif_name: 'lateral_pivot',
      chain_key: 'Machine:C1',
      matched_edges: ['e1'],
      completed_at: 100,
      confidence: 1,
    },
  })
}

describe('useLiveNotifications', () => {
  beforeEach(() => {
    toastMock.mockClear()
    useLiveStreamStore.setState({
      status: 'open',
      events: [],
      lastHeartbeatAt: null,
      lastError: null,
    })
  })

  it('does not toast for events already buffered before this hook mounted', () => {
    pushCompletion(1000) // long before "now" -- a pre-existing store event
    renderHook(() => useLiveNotifications())

    expect(toastMock).not.toHaveBeenCalled()
  })

  it('toasts for an alert event arriving after mount', () => {
    renderHook(() => useLiveNotifications())

    act(() => pushCompletion(Date.now() + 60_000))

    expect(toastMock).toHaveBeenCalledWith('lateral_pivot completed (chain Machine:C1)')
  })

  it('does nothing when disabled', () => {
    renderHook(() => useLiveNotifications({ enabled: false }))

    act(() => pushCompletion(Date.now() + 60_000))

    expect(toastMock).not.toHaveBeenCalled()
  })
})
