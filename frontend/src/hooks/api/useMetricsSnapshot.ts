import { useQuery } from '@tanstack/react-query'
import { getMetricsSnapshot } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'

// F4.2: backs F6.2/F6.3/F6.6's executive-dashboard tiles. The snapshot is
// whatever `scripts/run_pipeline.py` last persisted -- a short
// `refetchInterval` is the polling fallback until F13's live stream (F4.6)
// takes over pushing fresher values while that page is mounted.
export function useMetricsSnapshot() {
  return useQuery({
    queryKey: queryKeys.metricsSnapshot(),
    queryFn: ({ signal }) => getMetricsSnapshot(signal),
    staleTime: 4_000,
    refetchInterval: 5_000,
  })
}
