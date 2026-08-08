import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { NotificationsPanel } from '@/features/monitoring/NotificationsPanel'
import { useLiveStreamStore } from '@/store/liveStreamStore'
import { useNotificationsStore } from '@/store/notificationsStore'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

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

describe('NotificationsPanel', () => {
  beforeEach(() => {
    useLiveStreamStore.setState({
      status: 'open',
      events: [],
      lastHeartbeatAt: null,
      lastError: null,
    })
    useNotificationsStore.setState({ lastReadAt: 0 })
  })

  it('shows no unread badge when there are no alerts', () => {
    render(<NotificationsPanel />, { wrapper })

    expect(screen.queryByLabelText(/unread alerts/)).not.toBeInTheDocument()
  })

  it('shows an unread badge counting alerts newer than lastReadAt', () => {
    pushCompletion(1000)
    pushCompletion(2000)

    render(<NotificationsPanel />, { wrapper })

    expect(screen.getByLabelText('2 unread alerts')).toBeInTheDocument()
  })

  it('lists recent alerts and marks them read on open', async () => {
    pushCompletion(1000)
    const user = userEvent.setup()

    render(<NotificationsPanel />, { wrapper })
    await user.click(screen.getByRole('button', { name: 'Notifications' }))

    expect(
      await screen.findByText('lateral_pivot completed (chain Machine:C1)'),
    ).toBeInTheDocument()
    expect(useNotificationsStore.getState().lastReadAt).toBeGreaterThanOrEqual(1000)
  })
})
