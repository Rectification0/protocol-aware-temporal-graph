import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { THREAT_TIER_SCORE_THRESHOLDS } from '@/features/analytics/logic'
import type { EntityScoreOut, MotifCompletionOut, Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listMotifCompletions: vi.fn(),
  listEntityScores: vi.fn(),
}))

const { listMotifCompletions, listEntityScores } = await import('@/api/endpoints')
const { TopTargetedResourcesChart } = await import('@/features/analytics/TopTargetedResourcesChart')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function mock(completions: MotifCompletionOut[], scores: EntityScoreOut[]) {
  vi.mocked(listMotifCompletions).mockResolvedValue({
    items: completions,
    limit: 500,
    offset: 0,
    total: null,
  } satisfies Paginated<MotifCompletionOut>)
  vi.mocked(listEntityScores).mockResolvedValue({
    items: scores,
    limit: 500,
    offset: 0,
    total: null,
  } satisfies Paginated<EntityScoreOut>)
}

describe('TopTargetedResourcesChart', () => {
  it('renders a chart of the most-targeted machines', async () => {
    const malicious = THREAT_TIER_SCORE_THRESHOLDS.critical + 1
    mock(
      [
        {
          id: 1,
          motif_name: 'lateral_pivot',
          chain_key: 'Machine:C1',
          matched_edges: ['e1'],
          completed_at: 0,
          confidence: 1,
        },
      ],
      [{ entity_id: 'Machine:C2', score: malicious, t: 0, trigger: 'scheduled', motif_name: null }],
    )

    const { container } = render(<TopTargetedResourcesChart />, { wrapper })

    expect(await screen.findByText('Top Targeted Resources')).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('[data-chart]')).toBeTruthy())
  })

  it('shows an empty state when no machine has been targeted', async () => {
    mock([], [])

    render(<TopTargetedResourcesChart />, { wrapper })

    expect(await screen.findByText('No targeted machines yet')).toBeInTheDocument()
  })
})
