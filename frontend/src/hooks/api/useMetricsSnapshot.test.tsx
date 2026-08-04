import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { MetricsSnapshotOut } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  getMetricsSnapshot: vi.fn(),
}))

const { getMetricsSnapshot } = await import('@/api/endpoints')
const { useMetricsSnapshot } = await import('@/hooks/api/useMetricsSnapshot')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useMetricsSnapshot', () => {
  it('exposes the fetched snapshot once loaded', async () => {
    const snapshot: MetricsSnapshotOut = {
      active_graph_size: 12,
      prune_rate_per_second: 0.5,
      epsilon: 0.2,
      motif_hit_rate_per_second: 0.01,
      motif_reset_rate_per_second: 0.02,
      latest_inference_latency_seconds: 0.03,
    }
    vi.mocked(getMetricsSnapshot).mockResolvedValue(snapshot)

    const { result } = renderHook(() => useMetricsSnapshot(), { wrapper })

    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data).toEqual(snapshot)
  })
})
