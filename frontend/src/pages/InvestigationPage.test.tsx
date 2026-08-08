import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { EntityScoreOut, MotifCompletionOut, Paginated, PrunedEdgeOut } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  getEntityScore: vi.fn(),
  getEntityForensics: vi.fn(),
  listMotifCompletions: vi.fn(),
}))

const { getEntityScore, getEntityForensics, listMotifCompletions } = await import('@/api/endpoints')
const { Component: InvestigationPage } = await import('@/pages/InvestigationPage')

function renderAt(entityId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/investigation/${encodeURIComponent(entityId)}`]}>
        <Routes>
          <Route path="/investigation/:entityId" element={<InvestigationPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('InvestigationPage (Milestone F10)', () => {
  it('renders the risk score, timeline, and triggered rules for a real entity', async () => {
    vi.mocked(getEntityScore).mockResolvedValue({
      entity_id: 'User:alice',
      score: 7,
      t: 100,
      trigger: 'scheduled',
      motif_name: null,
    } satisfies EntityScoreOut)
    vi.mocked(getEntityForensics).mockResolvedValue([
      {
        edge_id: 'e1',
        src: 'User:alice',
        dst: 'Machine:C1042',
        edge_type: 'Authentication',
        protocol: 'RDP',
        t_e: 50,
        w_0: 1,
        w_at_prune: 0.2,
        pruned_at: 60,
        source_system: 'test',
        raw_event_id: null,
      },
    ] satisfies PrunedEdgeOut[])
    vi.mocked(listMotifCompletions).mockResolvedValue({
      items: [
        {
          id: 1,
          motif_name: 'lateral_pivot',
          chain_key: 'User:alice',
          matched_edges: ['e1', 'e2'],
          completed_at: 55,
          confidence: 1,
        },
      ] satisfies MotifCompletionOut[],
      limit: 50,
      offset: 0,
      total: 1,
    } satisfies Paginated<MotifCompletionOut>)

    renderAt('User:alice')

    expect(screen.getByRole('heading', { name: 'Investigation: User:alice' })).toBeInTheDocument()
    expect(screen.getByText('Entity type: User')).toBeInTheDocument()
    expect(await screen.findByText('Malicious')).toBeInTheDocument() // score 7 > critical threshold
    expect(await screen.findByText('Machine:C1042')).toBeInTheDocument() // timeline row
    expect(await screen.findByText('lateral_pivot')).toBeInTheDocument() // triggered rule row
    // F10.7-F10.9: BACKEND TODO panels.
    expect(screen.getAllByText('Not available yet')).toHaveLength(3)
  })

  it('shows an unavailable risk score when the entity has never been scored', async () => {
    vi.mocked(getEntityScore).mockRejectedValue(new Error('No score recorded for entity User:new'))
    vi.mocked(getEntityForensics).mockResolvedValue([] satisfies PrunedEdgeOut[])
    vi.mocked(listMotifCompletions).mockResolvedValue({
      items: [],
      limit: 50,
      offset: 0,
      total: 0,
    } satisfies Paginated<MotifCompletionOut>)

    renderAt('User:new')

    expect(await screen.findByText('No score recorded for entity User:new')).toBeInTheDocument()
  })
})
