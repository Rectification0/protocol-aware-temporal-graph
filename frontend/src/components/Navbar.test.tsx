import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import { Navbar } from './Navbar'

function renderNavbar() {
  const router = createMemoryRouter([
    { path: '/', Component: Navbar },
    { path: '/login', element: <div>Login page</div> },
  ])
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  useAuthStore.setState({ session: null })
})

describe('Navbar', () => {
  it('shows no logout control when unauthenticated', () => {
    renderNavbar()

    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument()
  })

  it('shows the logged-in analyst and a logout control once authenticated', () => {
    useAuthStore.getState().login('alice')
    renderNavbar()

    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument()
  })

  it('clears the session and navigates to /login on logout', async () => {
    const user = userEvent.setup()
    useAuthStore.getState().login('alice')
    renderNavbar()

    await user.click(screen.getByRole('button', { name: 'Log out' }))

    expect(useAuthStore.getState().session).toBeNull()
    expect(await screen.findByText('Login page')).toBeInTheDocument()
  })
})
