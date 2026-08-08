import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LiveStreamEvent, LiveStreamStatus } from '@/store/liveStreamStore'

vi.mock('@/api/liveStream', () => ({
  useLiveStream: vi.fn(),
}))

const { useLiveStream } = await import('@/api/liveStream')
const { LiveAttackCounter } = await import('@/features/analytics/LiveAttackCounter')

function streamResult(overrides: {
  status?: LiveStreamStatus
  events?: LiveStreamEvent[]
  lastHeartbeatAt?: number | null
}) {
  return {
    status: 'open' as LiveStreamStatus,
    events: [],
    lastHeartbeatAt: null,
    lastError: null,
    ...overrides,
  }
}

function motifCompletionEvent(receivedAt: number): LiveStreamEvent {
  return {
    type: 'motif_completion',
    receivedAt,
    data: {
      id: 1,
      motif_name: 'lateral_pivot',
      chain_key: 'Machine:C1',
      matched_edges: ['e1'],
      completed_at: receivedAt / 1000,
      confidence: 1,
    },
  }
}

describe('LiveAttackCounter', () => {
  it('shows a loading state while the stream is still connecting', () => {
    vi.mocked(useLiveStream).mockReturnValue(
      streamResult({ status: 'connecting', lastHeartbeatAt: null }),
    )

    render(<LiveAttackCounter />)

    expect(screen.getByText('Live Attack Counter')).toBeInTheDocument()
    expect(screen.queryByText(/in last/)).not.toBeInTheDocument()
  })

  it('counts motif_completion events within the window, anchored to the last heartbeat', () => {
    const anchor = 1_000_000
    vi.mocked(useLiveStream).mockReturnValue(
      streamResult({
        status: 'open',
        lastHeartbeatAt: anchor,
        events: [motifCompletionEvent(anchor), motifCompletionEvent(anchor - 10 * 60 * 1000)],
      }),
    )

    render(<LiveAttackCounter />)

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText(/in last 5m/)).toBeInTheDocument()
  })

  it('shows an unavailable message once open with no heartbeat yet received', () => {
    vi.mocked(useLiveStream).mockReturnValue(
      streamResult({ status: 'reconnecting', lastHeartbeatAt: null }),
    )

    render(<LiveAttackCounter />)

    expect(screen.getByText(/waiting for the first heartbeat/)).toBeInTheDocument()
  })
})
