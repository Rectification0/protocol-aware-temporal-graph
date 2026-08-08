import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { PaginationState } from '@tanstack/react-table'
import { listMotifCompletions } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { toOffsetParams, toPaginatedResult } from '@/hooks/api/pagination'
import type { TimeRange } from '@/store/timeRangeStore'

// F4.2/F4.5: F9's Detection Matrix. `motifName` filters to one motif
// definition (e.g. drilling into `lateral_pivot` only); omit for all.
// `range` (F8.1, optional) threads `start`/`end` through to the backend --
// see `useEntityScores`'s matching doc comment.
export function useMotifCompletions(
  pagination: PaginationState,
  motifName?: string,
  range?: TimeRange,
) {
  const params = { ...toOffsetParams(pagination), motifName, start: range?.start, end: range?.end }
  const query = useQuery({
    queryKey: queryKeys.motifCompletions(params),
    queryFn: ({ signal }) => listMotifCompletions({ ...params, signal }),
    staleTime: 5_000,
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  })
  return { ...query, ...toPaginatedResult(query.data, params) }
}
