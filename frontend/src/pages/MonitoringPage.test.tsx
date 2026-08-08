import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useLiveStreamStore } from '@/store/liveStreamStore'

const { Component: MonitoringPage } = await import('@/pages/MonitoringPage')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('MonitoringPage (Milestone F13 Live Monitoring)', () => {
  beforeEach(() => {
    useLiveStreamStore.setState({
      status: 'open',
      events: [],
      lastHeartbeatAt: null,
      lastError: null,
    })
  })

  it('renders the auto-refresh control, critical alerts, and live event feed sections together', () => {
    render(<MonitoringPage />, { wrapper })

    expect(screen.getByRole('heading', { name: 'Live Monitoring' })).toBeInTheDocument()
    expect(screen.getByText('Auto-refresh non-live data')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Critical Alerts' })).toBeInTheDocument()
    expect(screen.getByText('No critical alerts right now.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Live Event Stream' })).toBeInTheDocument()
    expect(screen.getByText('No live events yet.')).toBeInTheDocument()
  })
})
