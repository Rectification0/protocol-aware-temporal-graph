import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import { createQueryWrapper } from '@/test/query'
import { type LiveStreamEvent, useLiveStreamStore } from '@/store/liveStreamStore'

// F16.6: render-count regression tests for the high-frequency live path.
// Counting is done by swapping a leaf component for a counting stand-in,
// so these assert *how much re-renders* per SSE event, not just that the
// output is right -- the thing an innocent-looking refactor would break.

const renders = { sidebar: 0, severityBadge: 0 }

vi.mock('@/api/endpoints', async () => {
  const { endpointMockFactory } = await import('@/test/integration/endpointMocks')
  return endpointMockFactory()
})
vi.mock('@/components/Sidebar', () => ({
  Sidebar: () => {
    renders.sidebar++
    return <nav aria-label="Main navigation" />
  },
}))
vi.mock('@/components/severity-badge', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  SeverityBadge: ({ severity }: { severity: string }) => {
    renders.severityBadge++
    return <span>{severity}</span>
  },
}))

const { mockAllEndpoints, renderApp } = await import('@/test/integration/renderApp')
const { LiveEventFeed } = await import('@/features/monitoring/LiveEventFeed')

let seq = 0
function criticalEvent(): LiveStreamEvent {
  seq++
  return {
    type: 'motif_completion',
    data: {
      id: seq,
      motif_name: 'lateral_pivot',
      chain_key: `Machine:C${seq}`,
      matched_edges: [],
      completed_at: 1_700_000_000 + seq,
      confidence: 1,
    },
    receivedAt: Date.now() + seq,
  }
}

function push(n: number) {
  act(() => {
    for (let i = 0; i < n; i++) useLiveStreamStore.getState().pushEvent(criticalEvent())
  })
}

beforeEach(() => {
  renders.sidebar = 0
  renders.severityBadge = 0
  mockAllEndpoints()
  useLiveStreamStore.setState({ events: [], status: 'open', lastHeartbeatAt: null })
  useAuthStore.setState({ session: null })
})

describe('live-path render counts (F16.6)', () => {
  it('the app shell does not re-render on live events or heartbeats', async () => {
    useAuthStore.getState().login('alice')
    renderApp('/settings')
    await screen.findByRole('heading', { name: 'Settings' })
    const baseline = renders.sidebar

    push(10)
    act(() => useLiveStreamStore.getState().recordHeartbeat(Date.now() / 1000))

    expect(renders.sidebar).toBe(baseline)
  })

  it('the live feed renders only the new row per event, not the whole list', () => {
    render(<LiveEventFeed />, { wrapper: createQueryWrapper().wrapper })
    push(20)
    const afterTwenty = renders.severityBadge
    expect(afterTwenty).toBeGreaterThanOrEqual(20)

    push(1)

    // One new row's badge -- not 21 re-renders of every row.
    expect(renders.severityBadge).toBe(afterTwenty + 1)
  })
})
