import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { AlertResponseTimeOut } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  getAlertResponseTime: vi.fn(),
}))

const { getAlertResponseTime } = await import('@/api/endpoints')
const { AverageResponseTimeTile } =
  await import('@/features/security-overview/AverageResponseTimeTile')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('AverageResponseTimeTile', () => {
  it('renders a formatted average', async () => {
    vi.mocked(getAlertResponseTime).mockResolvedValue({
      average_seconds: 90,
      sample_size: 4,
    } satisfies AlertResponseTimeOut)

    render(<AverageResponseTimeTile />, { wrapper })

    expect(await screen.findByText('1m 30s')).toBeInTheDocument()
  })

  it('shows an unavailable message when there are no acknowledgements yet', async () => {
    vi.mocked(getAlertResponseTime).mockResolvedValue({
      average_seconds: null,
      sample_size: 0,
    } satisfies AlertResponseTimeOut)

    render(<AverageResponseTimeTile />, { wrapper })

    expect(await screen.findByText('No acknowledged alerts yet')).toBeInTheDocument()
  })
})
