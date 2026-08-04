import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { PaginationState } from '@tanstack/react-table'
import { listAuditLog } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { toOffsetParams, toPaginatedResult } from '@/hooks/api/pagination'
import type { AuditRecordType } from '@/types/api'

export interface UseAuditLogFilters {
  since?: number
  type?: AuditRecordType
}

// F4.2/F4.5: F11's Log Explorer. Unlike the other list endpoints, F0.8's
// envelope always returns `total` (a full file scan per request, per
// audit.py's own docstring), so `toPaginatedResult`'s exact-pageCount
// branch applies here.
export function useAuditLog(pagination: PaginationState, filters: UseAuditLogFilters = {}) {
  const params = { ...toOffsetParams(pagination), ...filters }
  const query = useQuery({
    queryKey: queryKeys.auditLog(params),
    queryFn: ({ signal }) => listAuditLog({ ...params, signal }),
    staleTime: 5_000,
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  })
  return { ...query, ...toPaginatedResult(query.data, params) }
}
