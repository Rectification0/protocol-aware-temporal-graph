import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { MotifCompletionOut, Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listMotifCompletions: vi.fn(),
}))

const { listMotifCompletions } = await import('@/api/endpoints')
const { AttackPatternsChart } = await import('@/features/analytics/AttackPatternsChart')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('AttackPatternsChart', () => {
  it('renders a chart of motif-completion counts grouped by motif_name', async () => {
    vi.mocked(listMotifCompletions).mockResolvedValue({
      items: [
        {
          id: 1,
          motif_name: 'lateral_pivot',
          chain_key: 'Machine:C1',
          matched_edges: ['e1'],
          completed_at: 0,
          confidence: 1,
        },
      ],
      limit: 500,
      offset: 0,
      total: null,
    } satisfies Paginated<MotifCompletionOut>)

    const { container } = render(<AttackPatternsChart />, { wrapper })

    expect(await screen.findByText('Most Common Attack Patterns')).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('[data-chart]')).toBeTruthy())
  })

  it('shows an empty state when no motif has completed', async () => {
    vi.mocked(listMotifCompletions).mockResolvedValue({
      items: [],
      limit: 500,
      offset: 0,
      total: null,
    } satisfies Paginated<MotifCompletionOut>)

    render(<AttackPatternsChart />, { wrapper })

    expect(await screen.findByText('No motif completions yet')).toBeInTheDocument()
  })
})
