import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import { Component as LoginPage } from './LoginPage'

function renderLoginAt(initialEntries: InitialEntry[]) {
  const router = createMemoryRouter(
    [
      { path: '/login', Component: LoginPage },
      { path: '/', element: <div>Home page</div> },
      { path: '/analytics', element: <div>Analytics page</div> },
    ],
    { initialEntries },
  )
  return render(<RouterProvider router={router} />)
}

// Default env is mock-auth enabled (VITE_MOCK_AUTH_ENABLED is unset in the
// test environment) -- the disabled state is covered separately in
// LoginPage.mockAuthDisabled.test.tsx, which mocks @/config/env instead.
beforeEach(() => {
  useAuthStore.setState({ session: null })
})

describe('LoginPage', () => {
  it('logs in and navigates home when no redirect target was requested', async () => {
    const user = userEvent.setup()
    renderLoginAt(['/login'])

    await user.type(screen.getByLabelText('Analyst name'), 'alice')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByText('Home page')).toBeInTheDocument()
    expect(useAuthStore.getState().session?.analyst).toBe('alice')
  })

  it('navigates back to the originally-requested path after logging in', async () => {
    const user = userEvent.setup()
    renderLoginAt([{ pathname: '/login', state: { from: '/analytics' } }])

    await user.type(screen.getByLabelText('Analyst name'), 'bob')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByText('Analytics page')).toBeInTheDocument()
  })

  it('does not log in on an empty submission', async () => {
    const user = userEvent.setup()
    renderLoginAt(['/login'])

    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(useAuthStore.getState().session).toBeNull()
  })
})
