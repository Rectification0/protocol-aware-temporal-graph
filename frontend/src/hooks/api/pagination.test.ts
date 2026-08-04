import { describe, expect, it } from 'vitest'
import { toOffsetParams, toPaginatedResult } from '@/hooks/api/pagination'

describe('toOffsetParams', () => {
  it('converts a react-table PaginationState to limit/offset', () => {
    expect(toOffsetParams({ pageIndex: 2, pageSize: 20 })).toEqual({ limit: 20, offset: 40 })
  })
})

describe('toPaginatedResult', () => {
  const params = { limit: 2, offset: 0 }

  it('handles the no-data-yet case', () => {
    expect(toPaginatedResult(undefined, params)).toEqual({
      rows: [],
      total: null,
      pageCount: 1,
      hasNextPage: false,
    })
  })

  it('computes an exact pageCount when the envelope carries a total (e.g. audit log)', () => {
    const result = toPaginatedResult({ items: ['a', 'b'], limit: 2, offset: 0, total: 5 }, params)
    expect(result).toMatchObject({ total: 5, pageCount: 3, hasNextPage: true })
  })

  it('falls back to a running floor when total is absent (e.g. scores/motifs)', () => {
    const fullPage = toPaginatedResult(
      { items: ['a', 'b'], limit: 2, offset: 0, total: null },
      params,
    )
    expect(fullPage.hasNextPage).toBe(true)
    expect(fullPage.pageCount).toBe(2) // current page (1) + 1 more, since the page was full

    const partialPage = toPaginatedResult(
      { items: ['a'], limit: 2, offset: 0, total: null },
      params,
    )
    expect(partialPage.hasNextPage).toBe(false)
    expect(partialPage.pageCount).toBe(1) // a short page means this is the last one
  })
})
