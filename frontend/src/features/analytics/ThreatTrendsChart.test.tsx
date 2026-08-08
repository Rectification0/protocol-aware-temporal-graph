import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimeRangeStore } from '@/store/timeRangeStore'
import type { EntityScoreOut, MotifCompletionOut, Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listEntityScores: vi.fn(),
  listMotifCompletions: vi.fn(),
}))

const { listEntityScores, listMotifCompletions } = await import('@/api/endpoints')
const { ThreatTrendsChart } = await import('@/features/analytics/ThreatTrendsChart')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('ThreatTrendsChart', () => {
  beforeEach(() => {
    // Default range: last 24h ending now -- matches `timeRangeStore.ts`'s
    // own default, reset per-test so the range-scoping test below doesn't
    // leak into the others.
    const nowMs = Date.now()
    useTimeRangeStore.setState({
      range: { start: (nowMs - 24 * 3600 * 1000) / 1000, end: nowMs / 1000 },
    })
  })

  it('renders a chart once completions and scores resolve with recent activity', async () => {
    const now = Math.floor(Date.now() / 1000)
    vi.mocked(listMotifCompletions).mockResolvedValue({
      items: [
        {
          id: 1,
          motif_name: 'lateral_pivot',
          chain_key: 'Machine:C1',
          matched_edges: ['e1'],
          completed_at: now,
          confidence: 1,
        },
      ] satisfies MotifCompletionOut[],
      limit: 500,
      offset: 0,
      total: null,
    } satisfies Paginated<MotifCompletionOut>)
    vi.mocked(listEntityScores).mockResolvedValue({
      items: [] satisfies EntityScoreOut[],
      limit: 500,
      offset: 0,
      total: null,
    } satisfies Paginated<EntityScoreOut>)

    const { container } = render(<ThreatTrendsChart />, { wrapper })

    expect(await screen.findByText('Threat Trends')).toBeInTheDocument()
    // Same reasoning as `ThreatSeverityChart.test.tsx`: wait for the
    // chart wrapper itself, not chart-internal content -- recharts'
    // `ResponsiveContainer` never resolves a nonzero size under jsdom.
    await waitFor(() => expect(container.querySelector('[data-chart]')).toBeTruthy())
  })

  it('shows an empty state when there is no recent activity', async () => {
    vi.mocked(listMotifCompletions).mockResolvedValue({
      items: [],
      limit: 500,
      offset: 0,
      total: null,
    } satisfies Paginated<MotifCompletionOut>)
    vi.mocked(listEntityScores).mockResolvedValue({
      items: [],
      limit: 500,
      offset: 0,
      total: null,
    } satisfies Paginated<EntityScoreOut>)

    render(<ThreatTrendsChart />, { wrapper })

    expect(await screen.findByText('No recent activity')).toBeInTheDocument()
  })

  it("fetches both endpoints scoped to F8.1's selected range", async () => {
    useTimeRangeStore.setState({ range: { start: 111, end: 222 } })
    vi.mocked(listMotifCompletions).mockResolvedValue({
      items: [],
      limit: 500,
      offset: 0,
      total: null,
    } satisfies Paginated<MotifCompletionOut>)
    vi.mocked(listEntityScores).mockResolvedValue({
      items: [],
      limit: 500,
      offset: 0,
      total: null,
    } satisfies Paginated<EntityScoreOut>)

    render(<ThreatTrendsChart />, { wrapper })

    await waitFor(() => expect(listMotifCompletions).toHaveBeenCalled())
    expect(listMotifCompletions).toHaveBeenCalledWith(
      expect.objectContaining({ start: 111, end: 222 }),
    )
    expect(listEntityScores).toHaveBeenCalledWith(expect.objectContaining({ start: 111, end: 222 }))
  })
})
