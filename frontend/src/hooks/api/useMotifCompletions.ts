import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { PaginationState } from '@tanstack/react-table'
import { listMotifCompletions } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { toOffsetParams, toPaginatedResult } from '@/hooks/api/pagination'
import type { TimeRange } from '@/store/timeRangeStore'

export interface UseMotifCompletionsOptions {
  /** Filters to one motif definition (e.g. `lateral_pivot` only); omit for all. */
  motifName?: string
  /** F10.5: filters to completions pivoting on one entity -- the User
   * Investigation page's "triggered rules" panel. */
  chainKey?: string
  /** F8.1: threads `start`/`end` through to the backend -- see
   * `useEntityScores`'s matching doc comment. */
  range?: TimeRange
}

// F4.2/F4.5: F9's Detection Matrix, F10's per-entity "triggered rules."
// An options object (rather than positional params) since this now has
// three independent, all-optional filters -- positional args stopped
// scaling once F10.5 added a third.
export function useMotifCompletions(
  pagination: PaginationState,
  options: UseMotifCompletionsOptions = {},
) {
  const { motifName, chainKey, range } = options
  const params = {
    ...toOffsetParams(pagination),
    motifName,
    chainKey,
    start: range?.start,
    end: range?.end,
  }
  const query = useQuery({
    queryKey: queryKeys.motifCompletions(params),
    queryFn: ({ signal }) => listMotifCompletions({ ...params, signal }),
    staleTime: 5_000,
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  })
  return { ...query, ...toPaginatedResult(query.data, params) }
}
