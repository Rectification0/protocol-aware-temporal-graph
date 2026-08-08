import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { PilotReportOut } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  getPilotReport: vi.fn(),
}))

const { getPilotReport } = await import('@/api/endpoints')
const { DetectionAccuracyChart } = await import('@/features/analytics/DetectionAccuracyChart')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const REPORT: PilotReportOut = {
  anomaly: {
    true_positives: 3,
    false_positives: 1,
    false_negatives: 0,
    precision: 0.75,
    recall: 1,
  },
  motif: {
    true_positives: 2,
    false_positives: 0,
    false_negatives: 1,
    precision: 1,
    recall: 0.6667,
  },
  evaluated_at: 1_700_000_000,
}

describe('DetectionAccuracyChart', () => {
  it('renders a chart once the pilot report resolves', async () => {
    vi.mocked(getPilotReport).mockResolvedValue(REPORT)

    const { container } = render(<DetectionAccuracyChart />, { wrapper })

    expect(await screen.findByText('Detection Accuracy')).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('[data-chart]')).toBeTruthy())
    expect(screen.getByText(/As of last pilot evaluation/)).toBeInTheDocument()
  })

  it('shows an empty state when no pilot report has been recorded', async () => {
    vi.mocked(getPilotReport).mockRejectedValue(new Error('not found'))

    render(<DetectionAccuracyChart />, { wrapper })

    expect(await screen.findByText('No pilot evaluation yet')).toBeInTheDocument()
  })
})
