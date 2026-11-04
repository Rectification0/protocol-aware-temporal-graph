import { useQuery } from '@tanstack/react-query'
import { getSecurityScore } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { useAutoRefreshStore } from '@/store/autoRefreshStore'

// F0.12: the backend computes the score on read from the same tables the
// pipeline keeps writing, and there's no SSE event for it, so it polls on
// F13.3's auto-refresh cadence like `useMetricsSnapshot` (its freshness
// gate reads the same snapshot). An ack or a disposition invalidates it
// straight away (`AckButton`, `useSubmitMotifFeedback`).
export function useSecurityScore() {
  const enabled = useAutoRefreshStore((state) => state.enabled)
  const intervalMs = useAutoRefreshStore((state) => state.intervalMs)
  return useQuery({
    queryKey: queryKeys.securityScore(),
    queryFn: ({ signal }) => getSecurityScore(signal),
    staleTime: 4_000,
    refetchInterval: enabled ? intervalMs : false,
  })
}
