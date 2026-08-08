import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { PilotReportOut } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  getPilotReport: vi.fn(),
}))

const { getPilotReport } = await import('@/api/endpoints')
const { DetectionRateTile } = await import('@/features/analytics/DetectionRateTile')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('DetectionRateTile', () => {
  it("renders pilot.py's real precision/recall, labeled as of last evaluation", async () => {
    const report: PilotReportOut = {
      anomaly: {
        true_positives: 3,
        false_positives: 1,
        false_negatives: 1,
        precision: 0.75,
        recall: 0.75,
      },
      motif: { true_positives: 2, false_positives: 0, false_negatives: 0, precision: 1, recall: 1 },
      evaluated_at: Date.now() / 1000 - 3600,
    }
    vi.mocked(getPilotReport).mockResolvedValue(report)

    render(<DetectionRateTile />, { wrapper })

    expect(await screen.findByText('Anomaly recall: 75%')).toBeInTheDocument()
    expect(screen.getByText('Motif recall: 100%')).toBeInTheDocument()
    expect(screen.getByText(/As of last pilot evaluation/)).toBeInTheDocument()
    expect(screen.getByText(/not live/)).toBeInTheDocument()
  })

  it('shows an unavailable message when no pilot report exists yet (404)', async () => {
    vi.mocked(getPilotReport).mockRejectedValue(new Error('No pilot report found'))

    render(<DetectionRateTile />, { wrapper })

    expect(await screen.findByText('No pilot report found')).toBeInTheDocument()
  })
})
