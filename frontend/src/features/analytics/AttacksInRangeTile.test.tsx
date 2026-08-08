import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { MotifCompletionOut, Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listMotifCompletions: vi.fn(),
}))

const { listMotifCompletions } = await import('@/api/endpoints')
const { AttacksInRangeTile } = await import('@/features/analytics/AttacksInRangeTile')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('AttacksInRangeTile', () => {
  it("renders the backend's exact total, not the page size", async () => {
    vi.mocked(listMotifCompletions).mockResolvedValue({
      items: [] satisfies MotifCompletionOut[],
      limit: 1,
      offset: 0,
      total: 7,
    } satisfies Paginated<MotifCompletionOut>)

    render(<AttacksInRangeTile />, { wrapper })

    expect(await screen.findByText('7')).toBeInTheDocument()
  })

  it('shows an unavailable message when the query fails', async () => {
    vi.mocked(listMotifCompletions).mockRejectedValue(new Error('boom'))

    render(<AttacksInRangeTile />, { wrapper })

    expect(await screen.findByText('boom')).toBeInTheDocument()
  })
})
