import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { LiveEventFeed } from '@/features/monitoring/LiveEventFeed'
import { useLiveStreamStore } from '@/store/liveStreamStore'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('LiveEventFeed', () => {
  beforeEach(() => {
    useLiveStreamStore.setState({
      status: 'open',
      events: [],
      lastHeartbeatAt: null,
      lastError: null,
    })
  })

  it('shows the connection status and an empty state with no events', () => {
    render(<LiveEventFeed />, { wrapper })

    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText('No live events yet.')).toBeInTheDocument()
  })

  it('renders a prune row without an Ack action (not a detection)', () => {
    useLiveStreamStore.getState().pushEvent({
      type: 'prune',
      receivedAt: 1000,
      data: {
        type: 'prune',
        edge_id: 'e1',
        src: 'User:alice',
        dst: 'Machine:C1',
        edge_type: 'Authentication',
        protocol: 'RDP',
        w_at_prune: 0.1,
        pruned_at: 100,
        logged_at: 100,
      },
    })

    render(<LiveEventFeed />, { wrapper })

    expect(screen.getByText('Pruned Authentication: User:alice -> Machine:C1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ack' })).not.toBeInTheDocument()
  })

  it('renders a motif completion row with an Ack action', () => {
    useLiveStreamStore.getState().pushEvent({
      type: 'motif_completion',
      receivedAt: 1000,
      data: {
        id: 1,
        motif_name: 'lateral_pivot',
        chain_key: 'Machine:C1',
        matched_edges: ['e1'],
        completed_at: 100,
        confidence: 1,
      },
    })

    render(<LiveEventFeed />, { wrapper })

    expect(screen.getByText('lateral_pivot completed (chain Machine:C1)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ack' })).toBeInTheDocument()
  })

  it('shows the stream error banner', () => {
    useLiveStreamStore.setState({ lastError: 'Postgres unavailable' })

    render(<LiveEventFeed />, { wrapper })

    expect(screen.getByText(/Postgres unavailable/)).toBeInTheDocument()
  })

  it('clears the feed on button click', async () => {
    useLiveStreamStore.getState().pushEvent({
      type: 'motif_reset',
      receivedAt: 1000,
      data: {
        id: 1,
        motif_name: 'lateral_pivot',
        chain_key: 'Machine:C1',
        triggering_edge_id: 'e1',
        matched_edges: ['e1'],
        reset_at: 100,
      },
    })
    const user = userEvent.setup()

    render(<LiveEventFeed />, { wrapper })
    expect(screen.getByText('lateral_pivot reset (chain Machine:C1)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear feed' }))

    expect(screen.getByText('No live events yet.')).toBeInTheDocument()
  })
})
