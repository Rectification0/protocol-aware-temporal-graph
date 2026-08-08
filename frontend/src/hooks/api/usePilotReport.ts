import { useQuery } from '@tanstack/react-query'
import { getPilotReport } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'

// F8.4: `pilot.py` is a batch tool a human runs, not a continuous
// process (this file's own backend router doc comment) -- so this is a
// long `staleTime` read with no polling, the same "near-static" treatment
// F4.2 already gives F0.9's config endpoints, not F6/F7's live-ish tiles.
// A missing report (404, no pilot run recorded yet) already isn't retried
// by the global policy (`queryClient.ts`'s `shouldRetry` -- 4xx never
// retries), so no per-hook override is needed, same as `usePrunedEdge`'s
// expected-404 case.
export function usePilotReport() {
  return useQuery({
    queryKey: queryKeys.pilotReport(),
    queryFn: ({ signal }) => getPilotReport(signal),
    staleTime: 5 * 60_000,
  })
}
