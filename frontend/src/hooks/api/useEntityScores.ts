import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { PaginationState } from '@tanstack/react-table'
import { listEntityScores } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { toOffsetParams, toPaginatedResult } from '@/hooks/api/pagination'

// F4.2/F4.5: F7's user-risk lists and F9's detection matrix both page
// through this. `keepPreviousData` avoids a loading flash between pages --
// the old page's rows stay rendered (with `isFetching` true) until the
// next page resolves, matching `DataTable`'s server-driven pagination props.
export function useEntityScores(pagination: PaginationState) {
  const params = toOffsetParams(pagination)
  const query = useQuery({
    queryKey: queryKeys.entityScores(params),
    queryFn: ({ signal }) => listEntityScores({ ...params, signal }),
    staleTime: 5_000,
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  })
  return { ...query, ...toPaginatedResult(query.data, params) }
}
