import { render } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { vi } from 'vitest'
import * as endpoints from '@/api/endpoints'
import { routes } from '@/router'
import { createQueryWrapper } from '@/test/query'

// F16.5: page-level integration harness -- the *real* route tree (AppShell,
// ProtectedRoute, lazy pages, error boundaries) over a mocked F4 API layer.
// Callers must `vi.mock('@/api/endpoints', endpointMockFactory)` (from
// ./endpointMocks -- a separate module on purpose: a mock factory that
// imported this file would import the very module it's mocking, a cycle
// that deadlocks the worker) before importing this module; this file only
// fills those stubs with empty-but-valid defaults, so a test
// overrides just the endpoints its own journey cares about.

const emptyPage = { items: [], limit: 20, offset: 0, total: 0 }

export function mockAllEndpoints() {
  const m = vi.mocked(endpoints)
  m.getMetricsSnapshot.mockResolvedValue({
    active_graph_size: 0,
    prune_rate_per_second: 0,
    epsilon: 0,
    motif_hit_rate_per_second: 0,
    motif_reset_rate_per_second: 0,
    latest_inference_latency_seconds: 0,
    total_edges_processed: 0,
  })
  m.getHealth.mockResolvedValue({
    status: 'ok',
    postgres: true,
    neo4j: true,
    redis: true,
    last_metrics_snapshot_age_seconds: 1,
  })
  m.listEntityScores.mockResolvedValue(emptyPage)
  m.listMotifCompletions.mockResolvedValue(emptyPage)
  m.listMotifResets.mockResolvedValue(emptyPage)
  m.listMotifFeedback.mockResolvedValue(emptyPage)
  m.listAuditLog.mockResolvedValue(emptyPage)
  m.listEntities.mockResolvedValue(emptyPage)
  m.listProtocolConfig.mockResolvedValue([])
  m.listMotifConfig.mockResolvedValue([])
  m.getEntityForensics.mockResolvedValue([])
  m.getAlertResponseTime.mockResolvedValue({ average_seconds: null, sample_size: 0 })
  m.getPilotReport.mockRejectedValue(new Error('no pilot report'))
  m.getEntityScore.mockRejectedValue(new Error('not scored'))
  m.getPrunedEdge.mockRejectedValue(new Error('not found'))
  m.acknowledgeAlert.mockResolvedValue({} as never)
  m.submitMotifFeedback.mockResolvedValue({} as never)
  m.getConfigCapabilities.mockResolvedValue({
    writes_enabled: false,
    min_lambda_p: 1e-8,
    max_lambda_p: 0.01,
    min_window_seconds: 60,
    max_window_seconds: 2592000,
  })
  m.listConfigChanges.mockResolvedValue(emptyPage)
  m.updateProtocolLambda.mockRejectedValue(new Error('writes disabled'))
  m.updateMotifWindow.mockRejectedValue(new Error('writes disabled'))
  return m
}

export function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const { queryClient } = createQueryWrapper()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...result, router, queryClient }
}
