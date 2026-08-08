import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/api/endpoints', () => ({
  getMetricsSnapshot: vi.fn().mockRejectedValue(new Error('no metrics snapshot recorded yet')),
  getHealth: vi.fn().mockRejectedValue(new Error('unavailable')),
  listEntityScores: vi.fn().mockRejectedValue(new Error('unavailable')),
  listEntities: vi.fn().mockRejectedValue(new Error('unavailable')),
  getAlertResponseTime: vi.fn().mockResolvedValue({ average_seconds: null, sample_size: 0 }),
}))

const { Component: SecurityOverviewPage } = await import('@/pages/SecurityOverviewPage')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('SecurityOverviewPage (Milestone F14 Company Security Overview)', () => {
  it('renders every section, reusing F6 tiles plus the three new F14 tiles', async () => {
    render(<SecurityOverviewPage />, { wrapper })

    expect(screen.getByRole('heading', { name: 'Company Security Overview' })).toBeInTheDocument()
    // F14.1 (reused F6.1/F6.2 tiles).
    expect(screen.getByText('Cybersecurity Score')).toBeInTheDocument()
    expect(screen.getByText('Security Level')).toBeInTheDocument()
    // F14.2 (reused F6.4/F6.5 tiles), with the non-SOAR caveat present.
    expect(screen.getByText('System Health')).toBeInTheDocument()
    expect(screen.getByText('Active Monitoring')).toBeInTheDocument()
    expect(
      screen.getByText(/not an automated incident-response\/SOAR capability/),
    ).toBeInTheDocument()
    // F14.3.
    expect(screen.getByText('Monitored Users')).toBeInTheDocument()
    expect(screen.getByText('Total Processed Logs')).toBeInTheDocument()
    expect(screen.getByText(/Analyzed sessions/)).toBeInTheDocument()
    // F14.4.
    expect(screen.getByText('Avg. Response Time')).toBeInTheDocument()
    expect(await screen.findByText('No acknowledged alerts yet')).toBeInTheDocument()
  })
})
