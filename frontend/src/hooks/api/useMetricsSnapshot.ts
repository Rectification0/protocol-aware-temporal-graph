import { useQuery } from '@tanstack/react-query'
import { getMetricsSnapshot } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { useAutoRefreshStore } from '@/store/autoRefreshStore'

// F4.2: backs F6.2/F6.3/F6.6's executive-dashboard tiles. The snapshot is
// whatever `scripts/run_pipeline.py` last persisted. `stream.py` (F0.10)
// has no `metrics_snapshot` SSE event type -- this endpoint is never
// pushed to, unlike the entity-scores/motif-completions/motif-resets
// queries F13.1's global live-stream connection invalidates -- so it
// stays polling-only. F13.3's `useAutoRefreshStore` is the resulting
// client-side control surface (`AutoRefreshControl`, Live Monitoring page)
// for that polling: `refetchInterval` follows the store's `intervalMs`
// while enabled, or turns off entirely (`false`) when the analyst pauses
// it, wherever this hook is mounted -- not just on the Monitoring page.
export function useMetricsSnapshot() {
  const enabled = useAutoRefreshStore((state) => state.enabled)
  const intervalMs = useAutoRefreshStore((state) => state.intervalMs)
  return useQuery({
    queryKey: queryKeys.metricsSnapshot(),
    queryFn: ({ signal }) => getMetricsSnapshot(signal),
    staleTime: 4_000,
    refetchInterval: enabled ? intervalMs : false,
  })
}
