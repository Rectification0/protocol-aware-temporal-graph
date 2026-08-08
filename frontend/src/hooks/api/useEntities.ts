import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { PaginationState } from '@tanstack/react-table'
import { listEntities } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { toOffsetParams, toPaginatedResult } from '@/hooks/api/pagination'

// F10.1: distinct known entity ids (`type` is a node-id type prefix, e.g.
// "User") for the User Investigation user-list page. Sourced from Neo4j
// cold storage (see `src/t_gnn/api/routers/entities.py`'s doc comment),
// which only changes when an edge is pruned -- near-static compared to
// F6/F7's live-ish tiles, so no `refetchInterval`.
export function useEntities(pagination: PaginationState, type?: string) {
  const params = { ...toOffsetParams(pagination), type }
  const query = useQuery({
    queryKey: queryKeys.entities(params),
    queryFn: ({ signal }) => listEntities({ ...params, signal }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
  return { ...query, ...toPaginatedResult(query.data, params) }
}
