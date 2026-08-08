import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Paginated } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listEntities: vi.fn(),
}))

const { listEntities } = await import('@/api/endpoints')
const { Component: UserListPage } = await import('@/pages/UserListPage')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('UserListPage (Milestone F10.1)', () => {
  it('renders every fetched user as a link to their investigation page', async () => {
    vi.mocked(listEntities).mockResolvedValue({
      items: ['User:alice', 'User:bob'],
      limit: 500,
      offset: 0,
      total: 2,
    } satisfies Paginated<string>)

    render(<UserListPage />, { wrapper })

    expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument()
    const link = await screen.findByRole('link', { name: 'User:alice' })
    expect(link).toHaveAttribute('href', '/investigation/User%3Aalice')
  })

  it('filters the list client-side as the user types', async () => {
    vi.mocked(listEntities).mockResolvedValue({
      items: ['User:alice', 'User:bob'],
      limit: 500,
      offset: 0,
      total: 2,
    } satisfies Paginated<string>)
    const user = userEvent.setup()

    render(<UserListPage />, { wrapper })
    await screen.findByRole('link', { name: 'User:alice' })

    await user.type(screen.getByPlaceholderText('Search users...'), 'bob')

    // SearchBar debounces onChange (300ms) -- wait for the filter to
    // actually apply rather than asserting immediately after typing.
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'User:alice' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('link', { name: 'User:bob' })).toBeInTheDocument()
  })

  it('shows an empty message when the query fails', async () => {
    vi.mocked(listEntities).mockRejectedValue(new Error('boom'))

    render(<UserListPage />, { wrapper })

    expect(await screen.findByText('Unable to load users.')).toBeInTheDocument()
  })
})
