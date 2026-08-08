import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveStreamStore } from '@/store/liveStreamStore'
import { useTimeRangeStore } from '@/store/timeRangeStore'
import type { AuditRecordOut, Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listAuditLog: vi.fn(),
}))

const { listAuditLog } = await import('@/api/endpoints')
const { Component: LogsPage } = await import('@/pages/LogsPage')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

function mockAuditLog(items: AuditRecordOut[], total = items.length) {
  vi.mocked(listAuditLog).mockResolvedValue({
    items,
    limit: 20,
    offset: 0,
    total,
  } satisfies Paginated<AuditRecordOut>)
}

const pruneRecord: AuditRecordOut = {
  type: 'prune',
  logged_at: 500,
  edge_id: 'e1',
  src: 'User:alice',
  dst: 'Machine:C1',
  edge_type: 'Authentication',
  protocol: 'RDP',
  w_at_prune: 0.05,
  pruned_at: 500,
}

const motifResetRecord: AuditRecordOut = {
  type: 'motif_reset',
  logged_at: 600,
  motif_name: 'lateral_pivot',
  chain_key: 'Machine:C2',
  triggering_edge_id: 'e2',
  matched_edges: ['e2'],
  reset_at: 600,
}

describe('LogsPage (Milestone F11 Log Explorer)', () => {
  beforeEach(() => {
    // Wide enough that fixture timestamps (in the low hundreds) always
    // fall inside it, regardless of when the suite actually runs.
    useTimeRangeStore.setState({ range: { start: 0, end: 9_999_999_999 } })
    useLiveStreamStore.setState({
      status: 'idle',
      events: [],
      lastHeartbeatAt: null,
      lastError: null,
    })
    vi.mocked(listAuditLog).mockReset()
  })

  it('renders prune and motif-reset rows with severity/summary/entity', async () => {
    mockAuditLog([motifResetRecord, pruneRecord])

    render(<LogsPage />, { wrapper })

    expect(screen.getByRole('heading', { name: 'Logs' })).toBeInTheDocument()
    expect(
      await screen.findByText('Motif reset: lateral_pivot (chain Machine:C2)'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Pruned Authentication (RDP): User:alice -> Machine:C1'),
    ).toBeInTheDocument()
    // F11.4: motif_reset floors at "medium", a fully-decayed prune reads as "info".
    expect(screen.getAllByText('Medium')).toHaveLength(1)
    expect(screen.getByText('Info')).toBeInTheDocument()
  })

  it('shows an empty state when no records match', async () => {
    mockAuditLog([])

    render(<LogsPage />, { wrapper })

    expect(await screen.findByText('No log records match the current filters.')).toBeInTheDocument()
  })

  it('opens the raw log dialog with pretty-printed JSON (F11.3)', async () => {
    mockAuditLog([pruneRecord])
    const user = userEvent.setup()

    render(<LogsPage />, { wrapper })

    await user.click(await screen.findByRole('button', { name: 'View raw' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/"edge_id": "e1"/)).toBeInTheDocument()
  })

  it('re-queries with the search term (F11.1)', async () => {
    mockAuditLog([pruneRecord])
    const user = userEvent.setup()

    render(<LogsPage />, { wrapper })
    await screen.findByText('Pruned Authentication (RDP): User:alice -> Machine:C1')

    await user.type(screen.getByPlaceholderText('Search logs...'), 'rdp')

    await waitFor(() =>
      expect(listAuditLog).toHaveBeenCalledWith(expect.objectContaining({ q: 'rdp' })),
    )
  })

  it('re-queries with the entity filter (F11.2)', async () => {
    mockAuditLog([pruneRecord])
    const user = userEvent.setup()

    render(<LogsPage />, { wrapper })
    await screen.findByText('Pruned Authentication (RDP): User:alice -> Machine:C1')

    await user.type(screen.getByPlaceholderText('Filter by entity id...'), 'User:alice')

    await waitFor(() =>
      expect(listAuditLog).toHaveBeenCalledWith(expect.objectContaining({ entity: 'User:alice' })),
    )
  })

  it('shows a "new events" banner and a highlighted row for a live prune event, without reordering the fetched page (F11.7)', async () => {
    mockAuditLog([pruneRecord])

    render(<LogsPage />, { wrapper })
    await screen.findByText('Pruned Authentication (RDP): User:alice -> Machine:C1')
    const callsBeforeLiveEvent = vi.mocked(listAuditLog).mock.calls.length

    useLiveStreamStore.getState().pushEvent({
      type: 'prune',
      data: {
        type: 'prune',
        logged_at: 999,
        edge_id: 'e-live',
        src: 'User:carol',
        dst: 'Machine:C9',
        edge_type: 'Authentication',
        protocol: 'SMB',
        w_at_prune: 0.9,
        pruned_at: 999,
      },
      // Comfortably after the query's own `dataUpdatedAt` (set the moment
      // the mocked fetch above resolved) so it isn't ever accidentally
      // treated as "already part of the fetched page."
      receivedAt: Date.now() + 60_000,
    })

    expect(await screen.findByText(/1 new log event/)).toBeInTheDocument()
    expect(
      screen.getByText('Pruned Authentication (SMB): User:carol -> Machine:C9'),
    ).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    // No extra fetch was triggered just by the live event arriving.
    expect(vi.mocked(listAuditLog).mock.calls.length).toBe(callsBeforeLiveEvent)
  })
})
