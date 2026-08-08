import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import type { EntityScoreOut, MotifCompletionOut, MotifFeedbackOut, Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listEntityScores: vi.fn(),
  listMotifCompletions: vi.fn(),
  listMotifFeedback: vi.fn(),
  submitMotifFeedback: vi.fn(),
}))

const { listEntityScores, listMotifCompletions, listMotifFeedback, submitMotifFeedback } =
  await import('@/api/endpoints')
const { Component: DetectionsPage } = await import('@/pages/DetectionsPage')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function mockData({
  completions = [],
  scores = [],
  feedback = [],
}: {
  completions?: MotifCompletionOut[]
  scores?: EntityScoreOut[]
  feedback?: MotifFeedbackOut[]
} = {}) {
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
  vi.mocked(listMotifFeedback).mockResolvedValue({
    items: feedback,
    limit: 500,
    offset: 0,
    total: null,
  } satisfies Paginated<MotifFeedbackOut>)
}

describe('DetectionsPage (Milestone F9 Detection Matrix)', () => {
  beforeEach(() => {
    useAuthStore.setState({ session: null })
  })

  it('renders merged motif and anomaly-path rows', async () => {
    mockData({
      completions: [
        {
          id: 1,
          motif_name: 'lateral_pivot',
          chain_key: 'Machine:C1042',
          matched_edges: ['e1'],
          completed_at: 100,
          confidence: 1,
        },
      ],
      scores: [
        { entity_id: 'User:bob', score: 20, t: 200, trigger: 'scheduled', motif_name: null },
      ],
    })

    render(<DetectionsPage />, { wrapper })

    expect(screen.getByRole('heading', { name: 'Detections' })).toBeInTheDocument()
    expect(await screen.findByText('motif:lateral_pivot')).toBeInTheDocument()
    expect(screen.getByText('tgnn_deviation')).toBeInTheDocument()
    expect(screen.getByText('Machine:C1042')).toBeInTheDocument()
    expect(screen.getByText('User:bob')).toBeInTheDocument()
  })

  it('shows "n/a" instead of TP/FP buttons for anomaly-path rows', async () => {
    mockData({
      scores: [
        { entity_id: 'User:bob', score: 20, t: 200, trigger: 'scheduled', motif_name: null },
      ],
    })

    render(<DetectionsPage />, { wrapper })

    expect(await screen.findByText('n/a')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'TP' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'FP' })).not.toBeInTheDocument()
  })

  it('submits a true-positive disposition for a motif row using the logged-in analyst', async () => {
    useAuthStore.getState().login('alice')
    mockData({
      completions: [
        {
          id: 1,
          motif_name: 'lateral_pivot',
          chain_key: 'Machine:C1042',
          matched_edges: ['e1'],
          completed_at: 100,
          confidence: 1,
        },
      ],
    })
    vi.mocked(submitMotifFeedback).mockResolvedValue({
      id: 1,
      motif_name: 'lateral_pivot',
      chain_key: 'Machine:C1042',
      disposition: 'true_positive',
      noted_at: 123,
      analyst: 'alice',
    })
    const user = userEvent.setup()

    render(<DetectionsPage />, { wrapper })

    await user.click(await screen.findByRole('button', { name: 'TP' }))

    await waitFor(() =>
      expect(submitMotifFeedback).toHaveBeenCalledWith({
        motif_name: 'lateral_pivot',
        chain_key: 'Machine:C1042',
        disposition: 'true_positive',
        analyst: 'alice',
      }),
    )
  })

  it('shows an empty state when there are no detections', async () => {
    mockData()

    render(<DetectionsPage />, { wrapper })

    expect(await screen.findByText('No detections match the current filters.')).toBeInTheDocument()
  })
})
