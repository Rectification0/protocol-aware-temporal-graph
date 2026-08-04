import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { HealthOut, MetricsSnapshotOut, Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  getMetricsSnapshot: vi.fn(),
  listEntityScores: vi.fn(),
  listMotifCompletions: vi.fn(),
  getHealth: vi.fn(),
}))

const { getHealth, getMetricsSnapshot, listEntityScores, listMotifCompletions } =
  await import('@/api/endpoints')
const { Component: HomePage } = await import('@/pages/HomePage')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('HomePage (Milestone F6 Executive Dashboard)', () => {
  it('renders all six F6.1-F6.6 tiles', async () => {
    const metrics: MetricsSnapshotOut = {
      active_graph_size: 42,
      prune_rate_per_second: 0.1,
      epsilon: 0.2,
      motif_hit_rate_per_second: 0,
      motif_reset_rate_per_second: 0,
      latest_inference_latency_seconds: 0.01,
    }
    const health: HealthOut = {
      status: 'ok',
      postgres: true,
      neo4j: true,
      redis: true,
      last_metrics_snapshot_age_seconds: 5,
    }
    vi.mocked(getMetricsSnapshot).mockResolvedValue(metrics)
    vi.mocked(listEntityScores).mockResolvedValue({
      items: [],
      limit: 1,
      offset: 0,
      total: null,
    } satisfies Paginated<never>)
    vi.mocked(listMotifCompletions).mockResolvedValue({
      items: [],
      limit: 20,
      offset: 0,
      total: null,
    } satisfies Paginated<never>)
    vi.mocked(getHealth).mockResolvedValue(health)

    render(<HomePage />, { wrapper })

    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByText('Cybersecurity Score')).toBeInTheDocument()
    expect(screen.getByText('Security Level')).toBeInTheDocument()
    expect(screen.getByText('Threat Status')).toBeInTheDocument()
    expect(screen.getByText('System Health')).toBeInTheDocument()
    expect(screen.getByText('Active Monitoring')).toBeInTheDocument()
    expect(screen.getByText('Last Analysis')).toBeInTheDocument()

    expect(await screen.findByText('Normal')).toBeInTheDocument()
    expect(await screen.findByText('Quiet')).toBeInTheDocument()
    expect(await screen.findByText('Healthy')).toBeInTheDocument()
    expect(await screen.findByText('Active')).toBeInTheDocument()
  })
})
