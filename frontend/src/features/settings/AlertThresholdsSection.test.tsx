import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/api/endpoints', () => ({
  listProtocolConfig: vi
    .fn()
    .mockResolvedValue([
      { protocol: 'RDP', lambda_p: 0.0025, half_life_hours: 4.6, description: 'Remote desktop' },
    ]),
  listMotifConfig: vi.fn().mockResolvedValue([
    {
      name: 'lateral_pivot',
      description: 'Two-hop lateral movement',
      window_seconds: 300,
      steps: [{}, {}],
    },
  ]),
}))

const { AlertThresholdsSection } = await import('@/features/settings/AlertThresholdsSection')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('AlertThresholdsSection', () => {
  it('renders the protocol and motif tables from F0.9', async () => {
    render(<AlertThresholdsSection />, { wrapper })

    expect(await screen.findByText('RDP')).toBeInTheDocument()
    expect(screen.getByText('4.6h')).toBeInTheDocument()
    expect(screen.getByText('lateral_pivot')).toBeInTheDocument()
    expect(screen.getByText('5m')).toBeInTheDocument()
    expect(screen.getByText('2 steps')).toBeInTheDocument()
  })
})
