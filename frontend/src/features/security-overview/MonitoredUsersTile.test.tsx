import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listEntities: vi.fn(),
}))

const { listEntities } = await import('@/api/endpoints')
const { MonitoredUsersTile } = await import('@/features/security-overview/MonitoredUsersTile')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('MonitoredUsersTile', () => {
  it("renders the backend's exact User count", async () => {
    vi.mocked(listEntities).mockResolvedValue({
      items: [],
      limit: 1,
      offset: 0,
      total: 42,
    } satisfies Paginated<string>)

    render(<MonitoredUsersTile />, { wrapper })

    expect(await screen.findByText('42')).toBeInTheDocument()
    expect(listEntities).toHaveBeenCalledWith(expect.objectContaining({ type: 'User' }))
  })

  it('shows an unavailable message when the query fails', async () => {
    vi.mocked(listEntities).mockRejectedValue(new Error('boom'))

    render(<MonitoredUsersTile />, { wrapper })

    expect(await screen.findByText('boom')).toBeInTheDocument()
  })
})
