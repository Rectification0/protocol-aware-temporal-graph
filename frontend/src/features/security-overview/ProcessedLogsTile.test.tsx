import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { MetricsSnapshotOut } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  getMetricsSnapshot: vi.fn(),
}))

const { getMetricsSnapshot } = await import('@/api/endpoints')
const { ProcessedLogsTile } = await import('@/features/security-overview/ProcessedLogsTile')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const SNAPSHOT: MetricsSnapshotOut = {
  active_graph_size: 10,
  prune_rate_per_second: 0,
  epsilon: 0.1,
  motif_hit_rate_per_second: 0,
  motif_reset_rate_per_second: 0,
  latest_inference_latency_seconds: 0.01,
  total_edges_processed: 123456,
}

describe('ProcessedLogsTile', () => {
  it('renders the lifetime edge-processed counter, comma-formatted', async () => {
    vi.mocked(getMetricsSnapshot).mockResolvedValue(SNAPSHOT)

    render(<ProcessedLogsTile />, { wrapper })

    expect(await screen.findByText('123,456')).toBeInTheDocument()
  })

  it('shows an unavailable message when no snapshot has been recorded', async () => {
    vi.mocked(getMetricsSnapshot).mockRejectedValue(new Error('no metrics snapshot recorded yet'))

    render(<ProcessedLogsTile />, { wrapper })

    expect(await screen.findByText('no metrics snapshot recorded yet')).toBeInTheDocument()
  })
})
