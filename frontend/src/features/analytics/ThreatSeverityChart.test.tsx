import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { THREAT_TIER_SCORE_THRESHOLDS } from '@/features/analytics/logic'
import type { EntityScoreOut, Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listEntityScores: vi.fn(),
}))

const { listEntityScores } = await import('@/api/endpoints')
const { ThreatSeverityChart } = await import('@/features/analytics/ThreatSeverityChart')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function score(entityId: string, value: number): EntityScoreOut {
  return { entity_id: entityId, score: value, t: 0, trigger: 'scheduled', motif_name: null }
}

describe('ThreatSeverityChart', () => {
  it('renders a chart once distribution data resolves', async () => {
    vi.mocked(listEntityScores).mockResolvedValue({
      items: [score('User:alice', THREAT_TIER_SCORE_THRESHOLDS.critical + 1)],
      limit: 500,
      offset: 0,
      total: null,
    } satisfies Paginated<EntityScoreOut>)

    const { container } = render(<ThreatSeverityChart />, { wrapper })

    expect(await screen.findByText('Threat Severity Distribution')).toBeInTheDocument()
    // The title above renders unconditionally, before the query resolves
    // -- wait for the chart wrapper itself (rendered once the loading
    // skeleton is replaced) rather than asserting on it immediately.
    // Recharts' `ResponsiveContainer` never resolves a nonzero size under
    // jsdom (no `ResizeObserver`), so this can't wait on chart-internal
    // content like legend text -- only on `ChartContainer`'s own
    // `data-chart` wrapper div, which mounts independently of that.
    await waitFor(() => expect(container.querySelector('[data-chart]')).toBeTruthy())
  })

  it('shows an empty state when there are no entity scores yet', async () => {
    vi.mocked(listEntityScores).mockResolvedValue({
      items: [],
      limit: 500,
      offset: 0,
      total: null,
    } satisfies Paginated<EntityScoreOut>)

    render(<ThreatSeverityChart />, { wrapper })

    expect(await screen.findByText('No detections yet')).toBeInTheDocument()
  })
})
