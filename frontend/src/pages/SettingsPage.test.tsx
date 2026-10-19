import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/api/endpoints', () => ({
  listProtocolConfig: vi.fn().mockResolvedValue([]),
  listMotifConfig: vi.fn().mockResolvedValue([]),
  getConfigCapabilities: vi.fn().mockResolvedValue({
    writes_enabled: false,
    min_lambda_p: 1e-8,
    max_lambda_p: 0.01,
    min_window_seconds: 60,
    max_window_seconds: 2592000,
  }),
}))

const { Component: SettingsPage } = await import('@/pages/SettingsPage')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('SettingsPage (Milestone F15)', () => {
  it('renders every settings section', () => {
    render(<SettingsPage />, { wrapper })

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    // F15.1
    expect(screen.getByText('Appearance')).toBeInTheDocument()
    // F15.2
    expect(screen.getByText('Notifications')).toBeInTheDocument()
    // F15.4 (reused F13.3 control)
    expect(screen.getByText('Auto-refresh')).toBeInTheDocument()
    expect(screen.getByText('Auto-refresh non-live data')).toBeInTheDocument()
    // F15.3
    expect(screen.getByText('API configuration')).toBeInTheDocument()
    // F15.5
    expect(screen.getByText('Alert thresholds')).toBeInTheDocument()
  })
})
