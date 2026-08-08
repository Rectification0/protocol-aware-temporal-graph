import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { routes } from '@/router'
import { useAuthStore } from '@/store/authStore'

function renderAt(path: string) {
  const memoryRouter = createMemoryRouter(routes, { initialEntries: [path] })
  // F6's Overview page fetches real data via TanStack Query -- a
  // `QueryClient` must be in context or `useQuery` throws synchronously
  // (caught by `RouteErrorBoundary`, masking every route's own content).
  // `retry: false` keeps this router/shell smoke test fast regardless of
  // the stubbed `fetch` below settling as an error.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={memoryRouter} />
    </QueryClientProvider>,
  )
}

// F3.2 gates every route under AppShell on the auth store -- reset it
// before each test so cases don't leak session state into each other.
beforeEach(() => {
  useAuthStore.setState({ session: null })
  // This suite only cares about routing/shell chrome, not real API data --
  // stub `fetch` so F6's dashboard tiles settle into their own "unavailable"
  // states instantly instead of hitting a real (likely absent) backend.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('network disabled in router.test.tsx')),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('router (unauthenticated)', () => {
  it('redirects a protected route to /login', async () => {
    renderAt('/analytics')

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })

  it('renders the login page without the app shell at /login', async () => {
    renderAt('/login')

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.queryByText('T-GNN SOC Dashboard')).not.toBeInTheDocument()
  })
})

describe('router (authenticated)', () => {
  beforeEach(() => {
    useAuthStore.getState().login('alice')
  })

  it('renders the shell (Navbar + Sidebar) with the Overview page at /', async () => {
    renderAt('/')

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByText('T-GNN SOC Dashboard')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Analytics' })).toBeInTheDocument()
    // F10.1: the new Users nav entry.
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument()
  })

  it('renders the Analytics page at /analytics', async () => {
    renderAt('/analytics')

    // Milestone F7 replaced this page's placeholder heading with the
    // real Threat Analytics page.
    expect(await screen.findByRole('heading', { name: 'Threat Analytics' })).toBeInTheDocument()
  })

  it('renders the Users list page at /investigation', async () => {
    renderAt('/investigation')

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
  })

  it('renders the Investigation page with the :entityId param at /investigation/:entityId', async () => {
    renderAt('/investigation/User:alice')

    expect(
      await screen.findByRole('heading', { name: /Investigation: User:alice/ }),
    ).toBeInTheDocument()
  })

  it('renders the Logs page at /logs', async () => {
    renderAt('/logs')

    // Milestone F11 replaced this page's placeholder heading with the
    // real Log Explorer page.
    expect(await screen.findByRole('heading', { name: 'Logs' })).toBeInTheDocument()
  })

  it('renders NotFoundPage for an unmatched path under the shell', async () => {
    renderAt('/this-route-does-not-exist')

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to overview/i })).toBeInTheDocument()
  })
})
