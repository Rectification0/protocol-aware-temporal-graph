import type { PaginationState } from '@tanstack/react-table'
import type { Paginated } from '@/types/api'

// F4.5: pagination glue matching F0.15's offset/limit envelope, shaped so
// every list hook in this folder can hand its result straight to F5.4's
// `DataTable` (`pageCount`/`pagination`/`onPaginationChange` props) without
// each page (F9, F11) re-deriving the same offset math.

export const DEFAULT_PAGE_SIZE = 20

export interface OffsetPageParams {
  limit: number
  offset: number
}

export function toOffsetParams(pagination: PaginationState): OffsetPageParams {
  return { limit: pagination.pageSize, offset: pagination.pageIndex * pagination.pageSize }
}

export interface PaginatedResult<T> {
  rows: T[]
  total: number | null
  /** Always a real number (never -1/undefined) since `DataTable` computes
   * `Math.max(getPageCount(), 1)` unconditionally. */
  pageCount: number
  hasNextPage: boolean
}

export function toPaginatedResult<T>(
  data: Paginated<T> | undefined,
  params: OffsetPageParams,
): PaginatedResult<T> {
  const rows = data?.items ?? []
  const total = data?.total ?? null
  const hasNextPage =
    rows.length === params.limit && (total === null || params.offset + params.limit < total)

  // Several endpoints (scores, motif completions/resets/feedback) omit
  // `total` in F0.15's envelope -- there's nothing to divide by, so
  // `pageCount` becomes a running floor: the current page, plus one more
  // once a full page's worth of rows proves another page might exist.
  // `audit.log` does return `total`, so its pageCount is exact.
  const pageCount =
    total !== null
      ? Math.max(1, Math.ceil(total / params.limit))
      : params.offset / params.limit + 1 + (hasNextPage ? 1 : 0)

  return { rows, total, pageCount, hasNextPage }
}
