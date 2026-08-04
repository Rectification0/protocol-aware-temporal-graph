import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { HealthOut } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  getHealth: vi.fn(),
}))

const { getHealth } = await import('@/api/endpoints')
const { SystemHealthTile } = await import('@/features/dashboard/SystemHealthTile')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('SystemHealthTile', () => {
  it('shows Healthy plus every dependency when all are reachable', async () => {
    const health: HealthOut = {
      status: 'ok',
      postgres: true,
      neo4j: true,
      redis: true,
      last_metrics_snapshot_age_seconds: 5,
    }
    vi.mocked(getHealth).mockResolvedValue(health)

    render(<SystemHealthTile />, { wrapper })

    expect(await screen.findByText('Healthy')).toBeInTheDocument()
    expect(screen.getByText('Postgres')).toBeInTheDocument()
    expect(screen.getByText('Neo4j')).toBeInTheDocument()
    expect(screen.getByText('Redis')).toBeInTheDocument()
  })

  it('shows Degraded when a dependency is unreachable', async () => {
    const health: HealthOut = {
      status: 'degraded',
      postgres: true,
      neo4j: false,
      redis: true,
      last_metrics_snapshot_age_seconds: null,
    }
    vi.mocked(getHealth).mockResolvedValue(health)

    render(<SystemHealthTile />, { wrapper })

    expect(await screen.findByText('Degraded')).toBeInTheDocument()
  })
})
