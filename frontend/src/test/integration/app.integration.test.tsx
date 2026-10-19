import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAlertAckStore } from '@/store/alertAckStore'
import { useAuthStore } from '@/store/authStore'
import { useLiveStreamStore } from '@/store/liveStreamStore'
import { useTimeRangeStore } from '@/store/timeRangeStore'
import type { MotifCompletionOut } from '@/types/api'

// F16.5: page-level integration tests -- whole user journeys through the
// real route tree (shell, auth gate, lazy pages, shared stores) over a
// mocked F4 API layer. Each page's own `*Page.test.tsx` already covers
// that page in isolation; these cover what only shows up across them.

vi.mock('@/api/endpoints', async () => {
  const { endpointMockFactory } = await import('@/test/integration/endpointMocks')
  return endpointMockFactory()
})

const { mockAllEndpoints, renderApp } = await import('@/test/integration/renderApp')

let api: ReturnType<typeof mockAllEndpoints>

beforeEach(() => {
  vi.clearAllMocks()
  api = mockAllEndpoints()
  useAuthStore.setState({ session: null })
  useLiveStreamStore.setState({ events: [], status: 'idle', lastError: null })
  useAlertAckStore.setState({ ackedKeys: {} })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function completion(overrides: Partial<MotifCompletionOut> = {}): MotifCompletionOut {
  return {
    id: 1,
    motif_name: 'lateral_pivot',
    chain_key: 'Machine:C1042',
    matched_edges: ['e1', 'e2'],
    completed_at: Date.now() / 1000,
    confidence: 1,
    ...overrides,
  }
}

describe('auth journey', () => {
  it('bounces a deep link through login and lands back on the requested page', async () => {
    const user = userEvent.setup()
    renderApp('/detections')

    await user.type(await screen.findByLabelText('Analyst name'), 'alice')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('heading', { name: 'Detections' })).toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
  })

  it('logging out from the navbar returns to the login page', async () => {
    const user = userEvent.setup()
    useAuthStore.getState().login('alice')
    renderApp('/')

    await user.click(await screen.findByRole('button', { name: 'Log out' }))

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(useAuthStore.getState().session).toBeNull()
  })
})

describe('navigation', () => {
  beforeEach(() => {
    useAuthStore.getState().login('alice')
  })

  it('moves between pages via the sidebar, keeping the shell mounted', async () => {
    const user = userEvent.setup()
    renderApp('/')
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })

    await user.click(within(nav).getByRole('link', { name: 'Detections' }))
    expect(await screen.findByRole('heading', { name: 'Detections' })).toBeInTheDocument()

    await user.click(within(nav).getByRole('link', { name: 'Logs' }))
    expect(await screen.findByRole('heading', { name: 'Logs' })).toBeInTheDocument()

    await user.click(within(nav).getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText('T-GNN SOC Dashboard')).toBeInTheDocument()
  })

  it('drills from the user list into that user’s investigation page', async () => {
    const user = userEvent.setup()
    api.listEntities.mockResolvedValue({ items: ['User:alice'], limit: 500, offset: 0, total: 1 })
    api.getEntityScore.mockResolvedValue({
      entity_id: 'User:alice',
      score: 0.4,
      t: 1,
      trigger: 'scheduled',
      motif_name: null,
    })
    renderApp('/investigation')

    await user.click(await screen.findByRole('link', { name: 'User:alice' }))

    expect(
      await screen.findByRole('heading', { name: /Investigation: User:alice/ }),
    ).toBeInTheDocument()
    // The heading renders before the page's queries fire -- wait for them.
    await waitFor(() =>
      expect(api.getEntityScore).toHaveBeenCalledWith('User:alice', expect.anything()),
    )
    await waitFor(() =>
      expect(api.getEntityForensics).toHaveBeenCalledWith(
        'User:alice',
        expect.any(Number),
        expect.any(Number),
        expect.anything(),
      ),
    )
  })

  it('shows the not-found page inside the shell for an unknown path', async () => {
    renderApp('/no-such-page')

    expect(await screen.findByText('Page not found')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
  })
})

describe('shared state across pages', () => {
  beforeEach(() => {
    useAuthStore.getState().login('alice')
  })

  it('the time range chosen on one page scopes queries on the next (F8.1 store)', async () => {
    const user = userEvent.setup()
    const range = { start: 1_700_000_000, end: 1_700_003_600 }
    useTimeRangeStore.setState({ range })
    renderApp('/analytics')

    await screen.findByRole('heading', { name: 'Threat Analytics' })
    await waitFor(() =>
      expect(api.listEntityScores).toHaveBeenCalledWith(
        expect.objectContaining({ start: range.start, end: range.end }),
      ),
    )

    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    await user.click(within(nav).getByRole('link', { name: 'Logs' }))
    await screen.findByRole('heading', { name: 'Logs' })

    await waitFor(() =>
      expect(api.listAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ since: range.start, until: range.end }),
      ),
    )
  })

  it('a live critical detection reaches Monitoring, and acking it posts once and sticks', async () => {
    const user = userEvent.setup()
    const event = completion()
    renderApp('/monitoring')
    await screen.findByRole('heading', { name: 'Live Monitoring' })
    expect(screen.getByText('No critical alerts right now.')).toBeInTheDocument()

    act(() => {
      useLiveStreamStore
        .getState()
        .pushEvent({ type: 'motif_completion', data: event, receivedAt: Date.now() })
    })

    const ackButtons = await screen.findAllByRole('button', { name: 'Ack' })
    await user.click(ackButtons[0])

    await waitFor(() =>
      expect(api.acknowledgeAlert).toHaveBeenCalledWith({
        detection_type: 'motif_completion',
        detection_ref: `${event.motif_name}:${event.chain_key}:${event.completed_at}`,
        analyst: 'alice',
      }),
    )
    expect((await screen.findAllByText('Acknowledged')).length).toBeGreaterThan(0)
    // The same detection shows in both Critical Alerts and the event feed;
    // one ack (shared alertAckStore key) settles every copy of it.
    expect(ackButtons.length).toBeGreaterThan(1)
    expect(screen.queryAllByRole('button', { name: 'Ack' })).toHaveLength(0)
    expect(api.acknowledgeAlert).toHaveBeenCalledTimes(1)
  })

  it('a TP disposition on Detections refreshes the feedback list', async () => {
    const user = userEvent.setup()
    api.listMotifCompletions.mockResolvedValue({
      items: [completion()],
      limit: 500,
      offset: 0,
      total: null,
    })
    renderApp('/detections')

    await user.click(await screen.findByRole('button', { name: 'TP' }))

    await waitFor(() =>
      expect(api.submitMotifFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          motif_name: 'lateral_pivot',
          chain_key: 'Machine:C1042',
          disposition: 'true_positive',
          analyst: 'alice',
        }),
      ),
    )
    // useSubmitMotifFeedback's invalidation -> a second feedback fetch.
    await waitFor(() => expect(api.listMotifFeedback).toHaveBeenCalledTimes(2))
  })
})

describe('failure containment (F16.9)', () => {
  beforeEach(() => {
    useAuthStore.getState().login('alice')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('every page still renders its shell and heading with the whole API down', async () => {
    for (const fn of Object.values(api)) fn.mockRejectedValue(new Error('API down'))

    const pages: [string, string | RegExp][] = [
      ['/', 'Overview'],
      ['/analytics', 'Threat Analytics'],
      ['/investigation', 'Users'],
      ['/investigation/User:alice', /Investigation: User:alice/],
      ['/detections', 'Detections'],
      ['/logs', 'Logs'],
      ['/monitoring', 'Live Monitoring'],
      ['/security-overview', 'Company Security Overview'],
      ['/settings', 'Settings'],
    ]
    for (const [path, heading] of pages) {
      const { unmount } = renderApp(path)
      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
      unmount()
    }
  })
})
