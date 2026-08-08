import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { THREAT_TIER_SCORE_THRESHOLDS } from '@/features/analytics/logic'
import type { EntityScoreOut, MotifCompletionOut, Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listMotifCompletions: vi.fn(),
  listEntityScores: vi.fn(),
}))

const { listMotifCompletions, listEntityScores } = await import('@/api/endpoints')
const { AttackFrequencyHeatmap } = await import('@/features/analytics/AttackFrequencyHeatmap')

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

describe('AttackFrequencyHeatmap', () => {
  it('renders the heatmap grid once data resolves', async () => {
    mock(
      [
        {
          id: 1,
          motif_name: 'lateral_pivot',
          chain_key: 'Machine:C1',
          matched_edges: ['e1'],
          completed_at: Date.UTC(2024, 0, 1, 5) / 1000,
          confidence: 1,
        },
      ],
      [],
    )

    render(<AttackFrequencyHeatmap />, { wrapper })

    expect(await screen.findByText('Attack Frequency (UTC)')).toBeInTheDocument()
    expect(await screen.findByLabelText('Mon, 05: 1')).toBeInTheDocument()
  })

  it('shows an empty state when there is no activity in the selected range', async () => {
    mock([], [])

    render(<AttackFrequencyHeatmap />, { wrapper })

    expect(await screen.findByText('No recent activity')).toBeInTheDocument()
  })

  it('ignores benign scores', async () => {
    mock([], [{ entity_id: 'User:alice', score: 0, t: 0, trigger: 'scheduled', motif_name: null }])

    render(<AttackFrequencyHeatmap />, { wrapper })

    expect(await screen.findByText('No recent activity')).toBeInTheDocument()
  })

  it('renders for a non-benign score', async () => {
    const malicious = THREAT_TIER_SCORE_THRESHOLDS.critical + 1
    mock(
      [],
      [
        {
          entity_id: 'User:alice',
          score: malicious,
          t: Date.UTC(2024, 0, 1, 5) / 1000,
          trigger: 'scheduled',
          motif_name: null,
        },
      ],
    )

    render(<AttackFrequencyHeatmap />, { wrapper })

    expect(await screen.findByLabelText('Mon, 05: 1')).toBeInTheDocument()
  })
})
