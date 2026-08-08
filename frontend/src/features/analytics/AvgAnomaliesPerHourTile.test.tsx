import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useTimeRangeStore } from '@/store/timeRangeStore'
import type { EntityScoreOut, Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listEntityScores: vi.fn(),
}))

const { listEntityScores } = await import('@/api/endpoints')
const { AvgAnomaliesPerHourTile } = await import('@/features/analytics/AvgAnomaliesPerHourTile')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('AvgAnomaliesPerHourTile', () => {
  it('divides the exact entity-score total by the selected range duration in hours', async () => {
    useTimeRangeStore.setState({ range: { start: 0, end: 4 * 3600 } }) // 4-hour range
    vi.mocked(listEntityScores).mockResolvedValue({
      items: [] satisfies EntityScoreOut[],
      limit: 1,
      offset: 0,
      total: 8,
    } satisfies Paginated<EntityScoreOut>)

    render(<AvgAnomaliesPerHourTile />, { wrapper })

    expect(await screen.findByText('2.00')).toBeInTheDocument()
  })

  it('shows an unavailable message when the query fails', async () => {
    useTimeRangeStore.setState({ range: { start: 0, end: 3600 } })
    vi.mocked(listEntityScores).mockRejectedValue(new Error('boom'))

    render(<AvgAnomaliesPerHourTile />, { wrapper })

    expect(await screen.findByText('boom')).toBeInTheDocument()
  })
})
