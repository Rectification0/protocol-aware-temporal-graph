import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { PaginationState } from '@tanstack/react-table'
import { listAuditLog } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { toOffsetParams, toPaginatedResult } from '@/hooks/api/pagination'
import type { AuditRecordType } from '@/types/api'

export interface UseAuditLogFilters {
  since?: number
  until?: number
  type?: AuditRecordType
  entity?: string
  q?: string
}

export interface UseAuditLogOptions {
  /** F11.7: the Log Explorer owns presenting newly-streamed-in records
   * itself (a "new events" affordance, not a silent reorder of the
   * currently-viewed page) -- it passes `false` here to opt out of this
   * hook's own polling refresh, which would otherwise reorder the visible
   * page out from under the user every 10s regardless of the live stream.
   * Every other consumer keeps the default 5-10s cadence from F4.2. */
  refetchInterval?: number | false
}

// F4.2/F4.5: F11's Log Explorer. Unlike the other list endpoints, F0.8's
// envelope always returns `total` (a full file scan per request, per
// audit.py's own docstring), so `toPaginatedResult`'s exact-pageCount
// branch applies here.
export function useAuditLog(
  pagination: PaginationState,
  filters: UseAuditLogFilters = {},
  options: UseAuditLogOptions = {},
) {
  const { refetchInterval = 10_000 } = options
  const params = { ...toOffsetParams(pagination), ...filters }
  const query = useQuery({
    queryKey: queryKeys.auditLog(params),
    queryFn: ({ signal }) => listAuditLog({ ...params, signal }),
    staleTime: 5_000,
    refetchInterval,
    placeholderData: keepPreviousData,
  })
  return { ...query, ...toPaginatedResult(query.data, params) }
}
