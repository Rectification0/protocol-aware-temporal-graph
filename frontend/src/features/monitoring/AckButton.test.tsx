import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAlertAckStore } from '@/store/alertAckStore'
import { useAuthStore } from '@/store/authStore'

vi.mock('@/api/endpoints', () => ({
  acknowledgeAlert: vi.fn(),
}))

const { acknowledgeAlert } = await import('@/api/endpoints')
const { AckButton } = await import('@/features/monitoring/AckButton')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('AckButton', () => {
  beforeEach(() => {
    useAlertAckStore.setState({ ackedKeys: {} })
    useAuthStore.setState({ session: null })
  })

  it('shows an Ack button when not yet acknowledged', () => {
    render(<AckButton detectionType="anomaly" detectionRef="User:alice:100" />, { wrapper })

    expect(screen.getByRole('button', { name: 'Ack' })).toBeInTheDocument()
  })

  it('submits the ack with the logged-in analyst and flips to Acknowledged', async () => {
    useAuthStore.getState().login('alice')
    vi.mocked(acknowledgeAlert).mockResolvedValue({
      detection_type: 'anomaly',
      detection_ref: 'User:alice:100',
      acknowledged_by: 'alice',
      acknowledged_at: 123,
      notes: null,
    })
    const user = userEvent.setup()

    render(<AckButton detectionType="anomaly" detectionRef="User:alice:100" />, { wrapper })
    await user.click(screen.getByRole('button', { name: 'Ack' }))

    await waitFor(() =>
      expect(acknowledgeAlert).toHaveBeenCalledWith({
        detection_type: 'anomaly',
        detection_ref: 'User:alice:100',
        analyst: 'alice',
      }),
    )
    expect(await screen.findByText('Acknowledged')).toBeInTheDocument()
    expect(useAlertAckStore.getState().isAcked('anomaly', 'User:alice:100')).toBe(true)
  })

  it('shows Acknowledged directly when the store already has this detection acked', () => {
    useAlertAckStore.getState().markAcked('anomaly', 'User:alice:100')

    render(<AckButton detectionType="anomaly" detectionRef="User:alice:100" />, { wrapper })

    expect(screen.getByText('Acknowledged')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ack' })).not.toBeInTheDocument()
  })
})
