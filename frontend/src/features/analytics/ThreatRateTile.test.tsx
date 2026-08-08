import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useTimeRangeStore } from '@/store/timeRangeStore'
import type { MotifCompletionOut, Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listMotifCompletions: vi.fn(),
}))

const { listMotifCompletions } = await import('@/api/endpoints')
const { ThreatRateTile } = await import('@/features/analytics/ThreatRateTile')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('ThreatRateTile', () => {
  it('divides the exact attack total by the selected range duration in hours', async () => {
    useTimeRangeStore.setState({ range: { start: 0, end: 2 * 3600 } }) // 2-hour range
    vi.mocked(listMotifCompletions).mockResolvedValue({
      items: [] satisfies MotifCompletionOut[],
      limit: 1,
      offset: 0,
      total: 10,
    } satisfies Paginated<MotifCompletionOut>)

    render(<ThreatRateTile />, { wrapper })

    expect(await screen.findByText('5.00')).toBeInTheDocument()
    expect(screen.getByText('attacks/hr')).toBeInTheDocument()
  })

  it('shows an unavailable message when the query fails', async () => {
    useTimeRangeStore.setState({ range: { start: 0, end: 3600 } })
    vi.mocked(listMotifCompletions).mockRejectedValue(new Error('boom'))

    render(<ThreatRateTile />, { wrapper })

    expect(await screen.findByText('boom')).toBeInTheDocument()
  })
})
