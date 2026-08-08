import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { THREAT_TIER_SCORE_THRESHOLDS } from '@/features/analytics/logic'
import { useTimeRangeStore } from '@/store/timeRangeStore'
import type { EntityScoreOut, Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listEntityScores: vi.fn(),
}))

const { listEntityScores } = await import('@/api/endpoints')
const { UserThreatCountsPanel } = await import('@/features/analytics/UserThreatCountsPanel')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function score(entityId: string, value: number): EntityScoreOut {
  return { entity_id: entityId, score: value, t: 0, trigger: 'scheduled', motif_name: null }
}

describe('UserThreatCountsPanel', () => {
  it('tallies users into malicious/suspicious/benign, ignoring machines', async () => {
    const malicious = THREAT_TIER_SCORE_THRESHOLDS.critical + 1
    const suspicious = THREAT_TIER_SCORE_THRESHOLDS.elevated + 1
    vi.mocked(listEntityScores).mockResolvedValue({
      items: [
        score('User:alice', malicious),
        score('User:bob', suspicious),
        score('User:carol', 0),
        score('Machine:C1042', malicious),
      ],
      limit: 500,
      offset: 0,
      total: null,
    } satisfies Paginated<EntityScoreOut>)

    render(<UserThreatCountsPanel />, { wrapper })

    expect(await screen.findByText('1 Malicious')).toBeInTheDocument()
    expect(screen.getByText('1 Suspicious')).toBeInTheDocument()
    expect(screen.getByText('1 Benign')).toBeInTheDocument()
  })

  it('shows an unavailable message when the scores query fails', async () => {
    vi.mocked(listEntityScores).mockRejectedValue(new Error('no data yet'))

    render(<UserThreatCountsPanel />, { wrapper })

    expect(await screen.findByText('no data yet')).toBeInTheDocument()
  })

  it('F8.1: fetches scores scoped to the selected range', async () => {
    useTimeRangeStore.setState({ range: { start: 111, end: 222 } })
    vi.mocked(listEntityScores).mockResolvedValue({
      items: [],
      limit: 500,
      offset: 0,
      total: null,
    } satisfies Paginated<EntityScoreOut>)

    render(<UserThreatCountsPanel />, { wrapper })

    await waitFor(() => expect(listEntityScores).toHaveBeenCalled())
    expect(listEntityScores).toHaveBeenCalledWith(expect.objectContaining({ start: 111, end: 222 }))
  })
})
