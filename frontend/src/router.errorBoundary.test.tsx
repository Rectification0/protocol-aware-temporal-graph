import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/store/authStore'

// F16.9: a page that throws during render must be caught by the
// authenticated layout route's in-shell `errorElement`, not the root one
// -- i.e. the Navbar/Sidebar survive. Kept in its own file because the
// `vi.mock` below replaces the Settings page for every test in the module.
vi.mock('@/pages/SettingsPage', () => ({
  Component: () => {
    throw new Error('settings exploded')
  },
}))

const { routes } = await import('@/router')

beforeEach(() => {
  useAuthStore.setState({ session: null })
  useAuthStore.getState().login('alice')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled')))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('router page-level error boundary (F16.9)', () => {
  it('renders a crashing page’s error inside the shell, keeping Navbar and Sidebar', async () => {
    const memoryRouter = createMemoryRouter(routes, { initialEntries: ['/settings'] })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={memoryRouter} />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('settings exploded')).toBeInTheDocument()
    expect(screen.getByText('T-GNN SOC Dashboard')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Analytics' })).toBeInTheDocument()
  })
})
