import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { EntityScoreOut, MotifCompletionOut, Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listEntityScores: vi.fn(),
  listMotifCompletions: vi.fn(),
}))
vi.mock('@/api/liveStream', () => ({
  useLiveStream: vi.fn(),
}))

const { listEntityScores, listMotifCompletions } = await import('@/api/endpoints')
const { useLiveStream } = await import('@/api/liveStream')
const { Component: AnalyticsPage } = await import('@/pages/AnalyticsPage')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('AnalyticsPage (Milestone F7 Threat Analytics)', () => {
  it('renders all four F7.1-F7.4 panels', async () => {
    vi.mocked(listEntityScores).mockResolvedValue({
      items: [] satisfies EntityScoreOut[],
      limit: 500,
      offset: 0,
      total: null,
    } satisfies Paginated<EntityScoreOut>)
    vi.mocked(listMotifCompletions).mockResolvedValue({
      items: [] satisfies MotifCompletionOut[],
      limit: 500,
      offset: 0,
      total: null,
    } satisfies Paginated<MotifCompletionOut>)
    vi.mocked(useLiveStream).mockReturnValue({
      status: 'open',
      events: [],
      lastHeartbeatAt: 1_000_000,
      lastError: null,
    })

    render(<AnalyticsPage />, { wrapper })

    expect(screen.getByRole('heading', { name: 'Threat Analytics' })).toBeInTheDocument()
    expect(screen.getByText('User Threat Tiers')).toBeInTheDocument()
    expect(screen.getByText('Live Attack Counter')).toBeInTheDocument()
    expect(await screen.findByText('Threat Trends (last 24h)')).toBeInTheDocument()
    expect(await screen.findByText('Threat Severity Distribution')).toBeInTheDocument()
  })
})
