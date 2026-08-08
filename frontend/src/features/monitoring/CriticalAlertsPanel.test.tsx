import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ANOMALY_SEVERITY_THRESHOLDS } from '@/features/detections/logic'
import { CriticalAlertsPanel } from '@/features/monitoring/CriticalAlertsPanel'
import { useLiveStreamStore } from '@/store/liveStreamStore'

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('CriticalAlertsPanel', () => {
  beforeEach(() => {
    useLiveStreamStore.setState({
      status: 'open',
      events: [],
      lastHeartbeatAt: null,
      lastError: null,
    })
  })

  it('shows a placeholder when there are no critical events', () => {
    render(<CriticalAlertsPanel />, { wrapper })

    expect(screen.getByText('No critical alerts right now.')).toBeInTheDocument()
  })

  it('renders a banner for a critical motif completion, with an Ack action', () => {
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

    render(<CriticalAlertsPanel />, { wrapper })

    expect(screen.getByText('Motif completed')).toBeInTheDocument()
    expect(screen.getByText('lateral_pivot completed (chain Machine:C1)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ack' })).toBeInTheDocument()
  })

  it('excludes non-critical events', () => {
    useLiveStreamStore.getState().pushEvent({
      type: 'inference_result',
      receivedAt: 1000,
      data: {
        entity_id: 'User:alice',
        score: ANOMALY_SEVERITY_THRESHOLDS.low - 0.01,
        t: 100,
        trigger: 'scheduled',
        motif_name: null,
      },
    })

    render(<CriticalAlertsPanel />, { wrapper })

    expect(screen.getByText('No critical alerts right now.')).toBeInTheDocument()
  })
})
