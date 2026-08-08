import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { EntityScoreOut, MotifCompletionOut, Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listEntityScores: vi.fn(),
  listMotifCompletions: vi.fn(),
  getPilotReport: vi.fn(),
}))
vi.mock('@/api/liveStream', () => ({
  useLiveStream: vi.fn(),
}))

const { listEntityScores, listMotifCompletions, getPilotReport } = await import('@/api/endpoints')
const { useLiveStream } = await import('@/api/liveStream')
const { Component: AnalyticsPage } = await import('@/pages/AnalyticsPage')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('AnalyticsPage (Milestones F7 Threat Analytics + F8 Time-Based Analytics)', () => {
  it('renders every F7/F8 panel plus the shared time-range filter', async () => {
    vi.mocked(listEntityScores).mockResolvedValue({
      items: [] satisfies EntityScoreOut[],
      limit: 500,
      offset: 0,
      total: 0,
    } satisfies Paginated<EntityScoreOut>)
    vi.mocked(listMotifCompletions).mockResolvedValue({
      items: [] satisfies MotifCompletionOut[],
      limit: 500,
      offset: 0,
      total: 0,
    } satisfies Paginated<MotifCompletionOut>)
    vi.mocked(getPilotReport).mockRejectedValue(new Error('No pilot report found'))
    vi.mocked(useLiveStream).mockReturnValue({
      status: 'open',
      events: [],
      lastHeartbeatAt: 1_000_000,
      lastError: null,
    })

    render(<AnalyticsPage />, { wrapper })

    expect(screen.getByRole('heading', { name: 'Threat Analytics' })).toBeInTheDocument()
    // F8.1: the shared time-range filter control.
    expect(screen.getByRole('button', { name: /pick a date range|\d{4}/i })).toBeInTheDocument()
    // F7.1-F7.4.
    expect(screen.getByText('User Threat Tiers')).toBeInTheDocument()
    expect(screen.getByText('Live Attack Counter')).toBeInTheDocument()
    expect(await screen.findByText('Threat Trends')).toBeInTheDocument()
    expect(await screen.findByText('Threat Severity Distribution')).toBeInTheDocument()
    // F8.2-F8.5.
    expect(screen.getByText('Hackers Detected')).toBeInTheDocument()
    expect(screen.getByText('Attacks Detected')).toBeInTheDocument()
    expect(screen.getByText('Threat Rate')).toBeInTheDocument()
    expect(screen.getByText('Detection Rate')).toBeInTheDocument()
    expect(screen.getByText('Avg. Anomalies / Hour')).toBeInTheDocument()
  })
})
