import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { PaginationState } from '@tanstack/react-table'
import { getEntityScore, listEntityScores } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { toOffsetParams, toPaginatedResult } from '@/hooks/api/pagination'
import type { TimeRange } from '@/store/timeRangeStore'

// F4.2/F4.5: F7's user-risk lists and F9's detection matrix both page
// through this. `keepPreviousData` avoids a loading flash between pages --
// the old page's rows stay rendered (with `isFetching` true) until the
// next page resolves, matching `DataTable`'s server-driven pagination props.
//
// `range` (F8.1, optional) threads `start`/`end` through to the backend --
// omit it for the unfiltered "top scores overall" queries F6/F7's original
// tiles already use; every F8 metric that's scoped to the selected range
// passes it.
export function useEntityScores(pagination: PaginationState, range?: TimeRange) {
  const params = { ...toOffsetParams(pagination), start: range?.start, end: range?.end }
  const query = useQuery({
    queryKey: queryKeys.entityScores(params),
    queryFn: ({ signal }) => listEntityScores({ ...params, signal }),
    staleTime: 5_000,
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  })
  return { ...query, ...toPaginatedResult(query.data, params) }
}

// F10.3: a point lookup for one entity's latest score -- the User
// Investigation page's risk-score display. A 404 ("never scored") is a
// real, expected outcome the generic retry policy (F4.4) already
// declines to retry, same as `usePrunedEdge`'s expected-404 case.
export function useEntityScore(entityId: string) {
  return useQuery({
    queryKey: queryKeys.entityScore(entityId),
    queryFn: ({ signal }) => getEntityScore(entityId, signal),
    enabled: Boolean(entityId),
    staleTime: 5_000,
  })
}
