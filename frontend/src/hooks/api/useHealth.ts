import { useQuery } from '@tanstack/react-query'
import { getHealth } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { useAutoRefreshStore } from '@/store/autoRefreshStore'

// F4.2: F6.4/F6.5's system-health tile. Not stream-covered (same reasoning
// as `useMetricsSnapshot`'s comment) -- F13.3's `useAutoRefreshStore`
// governs its polling too, capped at this hook's own 15s ceiling so
// health checks never poll faster than the metrics snapshot itself does,
// even if the shared control is set to its shortest interval.
export function useHealth() {
  const enabled = useAutoRefreshStore((state) => state.enabled)
  const intervalMs = useAutoRefreshStore((state) => state.intervalMs)
  return useQuery({
    queryKey: queryKeys.health(),
    queryFn: ({ signal }) => getHealth(signal),
    staleTime: 10_000,
    refetchInterval: enabled ? Math.max(intervalMs, 15_000) : false,
  })
}
