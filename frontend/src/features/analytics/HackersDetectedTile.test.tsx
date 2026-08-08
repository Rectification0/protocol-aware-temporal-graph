import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { THREAT_TIER_SCORE_THRESHOLDS } from '@/features/analytics/logic'
import type { EntityScoreOut, Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listEntityScores: vi.fn(),
}))

const { listEntityScores } = await import('@/api/endpoints')
const { HackersDetectedTile } = await import('@/features/analytics/HackersDetectedTile')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function score(entityId: string, value: number): EntityScoreOut {
  return { entity_id: entityId, score: value, t: 0, trigger: 'scheduled', motif_name: null }
}

describe('HackersDetectedTile', () => {
  it('counts only User: entities classified malicious', async () => {
    const malicious = THREAT_TIER_SCORE_THRESHOLDS.critical + 1
    const suspicious = THREAT_TIER_SCORE_THRESHOLDS.elevated + 1
    vi.mocked(listEntityScores).mockResolvedValue({
      items: [
        score('User:alice', malicious),
        score('User:bob', suspicious),
        score('Machine:C1042', malicious),
      ],
      limit: 500,
      offset: 0,
      total: null,
    } satisfies Paginated<EntityScoreOut>)

    render(<HackersDetectedTile />, { wrapper })

    expect(await screen.findByText('1')).toBeInTheDocument()
  })

  it('shows an unavailable message when the scores query fails', async () => {
    vi.mocked(listEntityScores).mockRejectedValue(new Error('boom'))

    render(<HackersDetectedTile />, { wrapper })

    expect(await screen.findByText('boom')).toBeInTheDocument()
  })
})
