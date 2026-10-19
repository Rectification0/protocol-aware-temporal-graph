import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '@/api/queryKeys'
import { useAutoRefreshStore } from '@/store/autoRefreshStore'
import { createQueryWrapper } from '@/test/query'
import type { Paginated } from '@/types/api'

// F16.4: unit tests for the F4.2 query hooks not already covered by their
// own file (`useMetricsSnapshot.test.tsx`, `pagination.test.ts`). The hooks
// are thin, so what's worth pinning is exactly their contract with the
// rest of the app: which params reach the endpoint (pagination -> offset/
// limit, filters), when a query is gated off, the polling cadence each
// one declares, and what a mutation invalidates.

vi.mock('@/api/endpoints', () => ({
  acknowledgeAlert: vi.fn(),
  getAlertResponseTime: vi.fn(),
  getEntityForensics: vi.fn(),
  getEntityScore: vi.fn(),
  getHealth: vi.fn(),
  getPilotReport: vi.fn(),
  getPrunedEdge: vi.fn(),
  listAuditLog: vi.fn(),
  listEntities: vi.fn(),
  listEntityScores: vi.fn(),
  listMotifCompletions: vi.fn(),
  listMotifConfig: vi.fn(),
  listMotifFeedback: vi.fn(),
  listMotifResets: vi.fn(),
  listProtocolConfig: vi.fn(),
  submitMotifFeedback: vi.fn(),
}))

const endpoints = await import('@/api/endpoints')
const hooks = await import('@/hooks/api')

function page<T>(items: T[], limit: number, offset: number, total: number | null = null) {
  return { items, limit, offset, total } satisfies Paginated<T>
}

const PAGE_2 = { pageIndex: 1, pageSize: 10 }

beforeEach(() => {
  vi.clearAllMocks()
  useAutoRefreshStore.setState({ enabled: true, intervalMs: 5_000 })
})

describe('paginated list hooks', () => {
  it('useEntityScores maps pagination + time range to offset params and paginated rows', async () => {
    vi.mocked(endpoints.listEntityScores).mockResolvedValue(page(['a', 'b'] as never[], 10, 10, 12))
    const { wrapper } = createQueryWrapper()

    const { result } = renderHook(
      () => hooks.useEntityScores(PAGE_2, { start: 100, end: 200 } as never),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(endpoints.listEntityScores).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 10, start: 100, end: 200 }),
    )
    expect(result.current.rows).toEqual(['a', 'b'])
    expect(result.current.total).toBe(12)
    expect(result.current.pageCount).toBe(2)
  })

  it('useMotifCompletions threads motifName/chainKey/range through', async () => {
    vi.mocked(endpoints.listMotifCompletions).mockResolvedValue(page([], 10, 10))
    const { wrapper } = createQueryWrapper()

    const { result } = renderHook(
      () =>
        hooks.useMotifCompletions(PAGE_2, {
          motifName: 'lateral_pivot',
          chainKey: 'User:alice',
          range: { start: 1, end: 2 } as never,
        }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(endpoints.listMotifCompletions).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 10,
        offset: 10,
        motifName: 'lateral_pivot',
        chainKey: 'User:alice',
        start: 1,
        end: 2,
      }),
    )
  })

  it('useAuditLog passes filters and honors refetchInterval: false (F11.7)', async () => {
    vi.mocked(endpoints.listAuditLog).mockResolvedValue(page([], 10, 10))
    const { queryClient, wrapper } = createQueryWrapper()
    const filters = { type: 'prune' as const, entity: 'User:alice', q: 'smb' }

    const { result } = renderHook(
      () => hooks.useAuditLog(PAGE_2, filters, { refetchInterval: false }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(endpoints.listAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 10, ...filters }),
    )
    const query = queryClient
      .getQueryCache()
      .find({ queryKey: queryKeys.auditLog({ limit: 10, offset: 10, ...filters }) })
    expect(query?.options).toMatchObject({ refetchInterval: false })
  })

  it('useEntities, useMotifResets and useMotifFeedback map pagination to offset params', async () => {
    vi.mocked(endpoints.listEntities).mockResolvedValue(page([], 10, 10))
    vi.mocked(endpoints.listMotifResets).mockResolvedValue(page([], 10, 10))
    vi.mocked(endpoints.listMotifFeedback).mockResolvedValue(page([], 10, 10))
    const { wrapper } = createQueryWrapper()

    const { result } = renderHook(
      () => [
        hooks.useEntities(PAGE_2, 'User'),
        hooks.useMotifResets(PAGE_2),
        hooks.useMotifFeedback(PAGE_2),
      ],
      { wrapper },
    )
    await waitFor(() => expect(result.current.every((q) => q.isSuccess)).toBe(true))

    expect(endpoints.listEntities).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'User', limit: 10, offset: 10 }),
    )
    expect(endpoints.listMotifResets).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 10 }),
    )
    expect(endpoints.listMotifFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 10 }),
    )
  })
})

describe('id-keyed hooks are gated on a non-empty id', () => {
  it('useEntityScore / useEntityForensics / usePrunedEdge do not fetch without an id', () => {
    const { wrapper } = createQueryWrapper()

    const { result } = renderHook(
      () => [
        hooks.useEntityScore(''),
        hooks.useEntityForensics('', 0, 1),
        hooks.usePrunedEdge(undefined),
      ],
      { wrapper },
    )

    expect(result.current.every((q) => q.fetchStatus === 'idle')).toBe(true)
    expect(endpoints.getEntityScore).not.toHaveBeenCalled()
    expect(endpoints.getEntityForensics).not.toHaveBeenCalled()
    expect(endpoints.getPrunedEdge).not.toHaveBeenCalled()
  })

  it('fetch with the id once one is given', async () => {
    vi.mocked(endpoints.getEntityScore).mockResolvedValue({} as never)
    vi.mocked(endpoints.getEntityForensics).mockResolvedValue([] as never)
    vi.mocked(endpoints.getPrunedEdge).mockResolvedValue({} as never)
    const { wrapper } = createQueryWrapper()

    const { result } = renderHook(
      () => [
        hooks.useEntityScore('User:alice'),
        hooks.useEntityForensics('User:alice', 0, 1),
        hooks.usePrunedEdge('e1'),
      ],
      { wrapper },
    )
    await waitFor(() => expect(result.current.every((q) => q.isSuccess)).toBe(true))

    expect(endpoints.getEntityScore).toHaveBeenCalledWith('User:alice', expect.anything())
    expect(endpoints.getEntityForensics).toHaveBeenCalledWith('User:alice', 0, 1, expect.anything())
    expect(endpoints.getPrunedEdge).toHaveBeenCalledWith('e1', expect.anything())
  })
})

describe('useHealth (F13.3 auto-refresh)', () => {
  function healthRefetchInterval() {
    vi.mocked(endpoints.getHealth).mockResolvedValue({} as never)
    const { queryClient, wrapper } = createQueryWrapper()
    renderHook(() => hooks.useHealth(), { wrapper })
    return queryClient.getQueryCache().find({ queryKey: queryKeys.health() })?.options
  }

  it('floors the polling interval at 15s even when auto-refresh is set faster', () => {
    useAutoRefreshStore.setState({ enabled: true, intervalMs: 5_000 })
    expect(healthRefetchInterval()).toMatchObject({ refetchInterval: 15_000 })
  })

  it('uses the configured interval when slower than the floor', () => {
    useAutoRefreshStore.setState({ enabled: true, intervalMs: 60_000 })
    expect(healthRefetchInterval()).toMatchObject({ refetchInterval: 60_000 })
  })

  it('stops polling when auto-refresh is disabled', () => {
    useAutoRefreshStore.setState({ enabled: false, intervalMs: 5_000 })
    expect(healthRefetchInterval()).toMatchObject({ refetchInterval: false })
  })
})

describe('single-resource hooks', () => {
  it('useProtocolConfig / useMotifConfig / usePilotReport / useAlertResponseTime expose fetched data', async () => {
    vi.mocked(endpoints.listProtocolConfig).mockResolvedValue(['p'] as never)
    vi.mocked(endpoints.listMotifConfig).mockResolvedValue(['m'] as never)
    vi.mocked(endpoints.getPilotReport).mockResolvedValue({ r: 1 } as never)
    vi.mocked(endpoints.getAlertResponseTime).mockResolvedValue({ t: 2 } as never)
    const { wrapper } = createQueryWrapper()

    const { result } = renderHook(
      () => [
        hooks.useProtocolConfig(),
        hooks.useMotifConfig(),
        hooks.usePilotReport(),
        hooks.useAlertResponseTime(),
      ],
      { wrapper },
    )
    await waitFor(() => expect(result.current.every((q) => q.isSuccess)).toBe(true))

    expect(result.current.map((q) => q.data)).toEqual([['p'], ['m'], { r: 1 }, { t: 2 }])
  })
})

describe('mutations', () => {
  it('useAlertAck posts the ack body', async () => {
    vi.mocked(endpoints.acknowledgeAlert).mockResolvedValue({} as never)
    const { wrapper } = createQueryWrapper()
    const body = { detection_type: 'motif', detection_ref: 'lateral_pivot:User:alice:1' }

    const { result } = renderHook(() => hooks.useAlertAck(), { wrapper })
    await act(() => result.current.mutateAsync(body))

    expect(endpoints.acknowledgeAlert).toHaveBeenCalledWith(body)
  })

  it('useSubmitMotifFeedback invalidates every motif-feedback page on success', async () => {
    vi.mocked(endpoints.submitMotifFeedback).mockResolvedValue({} as never)
    const { queryClient, wrapper } = createQueryWrapper()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const body = {
      motif_name: 'lateral_pivot',
      chain_key: 'User:alice',
      disposition: 'true_positive' as const,
    }

    const { result } = renderHook(() => hooks.useSubmitMotifFeedback(), { wrapper })
    await act(() => result.current.mutateAsync(body))

    expect(endpoints.submitMotifFeedback).toHaveBeenCalledWith(body)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['motifs', 'feedback'] })
  })

  it('useSubmitMotifFeedback does not invalidate on failure', async () => {
    vi.mocked(endpoints.submitMotifFeedback).mockRejectedValue(new Error('500'))
    const { queryClient, wrapper } = createQueryWrapper()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => hooks.useSubmitMotifFeedback(), { wrapper })
    await act(async () => {
      await result.current
        .mutateAsync({ motif_name: 'm', chain_key: 'k', disposition: 'false_positive' })
        .catch(() => {})
    })

    expect(invalidate).not.toHaveBeenCalled()
  })
})
