import { screen } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import { useLiveStreamStore } from '@/store/liveStreamStore'

// F16.3: an automated accessibility scan (axe-core, WCAG 2.x A/AA rules) of
// every page, rendered through the real route tree with data in it -- so a
// missing label, duplicate id, unnamed button or broken ARIA reference on
// any page fails the build instead of waiting for a manual audit.
//
// `color-contrast` is disabled here only because jsdom has no layout or
// computed colors, so axe can't evaluate it; contrast is covered instead by
// the token-level checks (src/index.css's documented >=4.5:1 verification
// and the dataviz palette validator).

vi.mock('@/api/endpoints', async () => {
  const { endpointMockFactory } = await import('@/test/integration/endpointMocks')
  return endpointMockFactory()
})

const { mockAllEndpoints, renderApp } = await import('@/test/integration/renderApp')

const now = Date.now() / 1000

beforeEach(() => {
  const api = mockAllEndpoints()
  // Real-looking content, so the scan covers populated tables and badges,
  // not just empty states.
  api.listMotifCompletions.mockResolvedValue({
    items: [
      {
        id: 1,
        motif_name: 'lateral_pivot',
        chain_key: 'Machine:C1042',
        matched_edges: ['e1', 'e2'],
        completed_at: now - 60,
        confidence: 1,
      },
    ],
    limit: 500,
    offset: 0,
    total: 1,
  })
  api.listEntityScores.mockResolvedValue({
    items: [
      { entity_id: 'User:alice', score: 2.5, t: now - 30, trigger: 'scheduled', motif_name: null },
    ],
    limit: 500,
    offset: 0,
    total: 1,
  })
  api.listEntities.mockResolvedValue({ items: ['User:alice'], limit: 500, offset: 0, total: 1 })
  api.listAuditLog.mockResolvedValue({
    items: [
      {
        type: 'prune',
        logged_at: now - 10,
        edge_id: 'e1',
        src: 'User:alice',
        dst: 'Machine:C1042',
        edge_type: 'Authentication',
        protocol: 'RDP',
        w_at_prune: 0.05,
        pruned_at: now - 10,
      },
    ],
    limit: 20,
    offset: 0,
    total: 1,
  })
  useAuthStore.setState({ session: null })
  useAuthStore.getState().login('alice')
  useLiveStreamStore.setState({ events: [], status: 'open', lastHeartbeatAt: now })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function violationsIn(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  })
  return results.violations.map(
    (v) => `${v.id}: ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  )
}

const PAGES: [path: string, heading: string | RegExp][] = [
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

describe('accessibility scan (F16.3)', () => {
  it.each(PAGES)(
    '%s has no axe violations',
    async (path, heading) => {
      const { container, unmount } = renderApp(path)
      await screen.findByRole('heading', { name: heading })
      // Let the page's queries settle so populated content is what gets scanned.
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(await violationsIn(container)).toEqual([])
      unmount()
      // axe walks every node; Analytics' full chart DOM takes ~25s under a
      // parallel full-suite run, past the default per-test budget.
    },
    60_000,
  )

  it('the login page has no axe violations', async () => {
    useAuthStore.setState({ session: null })
    const { container } = renderApp('/login')
    await screen.findByRole('heading', { name: 'Log in' })

    expect(await violationsIn(container)).toEqual([])
  })
})
