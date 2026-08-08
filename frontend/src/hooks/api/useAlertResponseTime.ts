import { useQuery } from '@tanstack/react-query'
import { getAlertResponseTime } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'

// F14.4: not on F0.10's live stream (no SSE event type for an ack), and
// not a fast-moving number either -- acks happen occasionally, not per
// edge -- so this is a moderate `staleTime` with no polling by default.
// `AckButton` (F13.6) invalidates this query key on a successful ack, so
// the average actually refreshes the moment a new one is recorded rather
// than waiting on a fixed interval.
export function useAlertResponseTime() {
  return useQuery({
    queryKey: queryKeys.alertResponseTime(),
    queryFn: ({ signal }) => getAlertResponseTime(signal),
    staleTime: 30_000,
  })
}
