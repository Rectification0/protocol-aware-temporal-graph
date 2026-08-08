import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { EntityScoreOut, MetricsSnapshotOut, Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  getMetricsSnapshot: vi.fn(),
  listEntityScores: vi.fn(),
}))

const { getMetricsSnapshot, listEntityScores } = await import('@/api/endpoints')
const { SecurityLevelTile } = await import('@/features/dashboard/SecurityLevelTile')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const BASE_METRICS: MetricsSnapshotOut = {
  active_graph_size: 10,
  prune_rate_per_second: 0,
  epsilon: 0.1,
  motif_hit_rate_per_second: 0,
  motif_reset_rate_per_second: 0,
  latest_inference_latency_seconds: 0.01,
  total_edges_processed: 0,
}

function scoresPage(score: number): Paginated<EntityScoreOut> {
  return {
    items: [{ entity_id: 'Machine:C1', score, t: 100, trigger: 'scheduled', motif_name: null }],
    limit: 1,
    offset: 0,
    total: null,
  }
}

describe('SecurityLevelTile', () => {
  it('renders Normal when both signals are quiet', async () => {
    vi.mocked(getMetricsSnapshot).mockResolvedValue(BASE_METRICS)
    vi.mocked(listEntityScores).mockResolvedValue(scoresPage(0))

    render(<SecurityLevelTile />, { wrapper })

    expect(await screen.findByText('Normal')).toBeInTheDocument()
  })

  it('escalates to Critical from a high-magnitude negative score', async () => {
    vi.mocked(getMetricsSnapshot).mockResolvedValue(BASE_METRICS)
    vi.mocked(listEntityScores).mockResolvedValue(scoresPage(-10))

    render(<SecurityLevelTile />, { wrapper })

    expect(await screen.findByText('Critical')).toBeInTheDocument()
  })

  it('shows the backend error message when the metrics snapshot fails to load', async () => {
    vi.mocked(getMetricsSnapshot).mockRejectedValue(new Error('no metrics snapshot recorded yet'))
    vi.mocked(listEntityScores).mockResolvedValue(scoresPage(0))

    render(<SecurityLevelTile />, { wrapper })

    expect(await screen.findByText('no metrics snapshot recorded yet')).toBeInTheDocument()
  })
})
