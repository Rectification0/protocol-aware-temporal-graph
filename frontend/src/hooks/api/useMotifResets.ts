import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { PaginationState } from '@tanstack/react-table'
import { listMotifResets } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { toOffsetParams, toPaginatedResult } from '@/hooks/api/pagination'

// F4.2/F4.5: motif resets (a partial match dropped because its edge got
// pruned first, FR3.3) -- shown alongside completions in F9's matrix as
// the "near misses" row.
export function useMotifResets(pagination: PaginationState) {
  const params = toOffsetParams(pagination)
  const query = useQuery({
    queryKey: queryKeys.motifResets(params),
    queryFn: ({ signal }) => listMotifResets({ ...params, signal }),
    staleTime: 5_000,
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  })
  return { ...query, ...toPaginatedResult(query.data, params) }
}
