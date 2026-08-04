import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

// F3.4: with the mock-auth bypass off and no real backend auth (F0.11),
// the login page should degrade honestly rather than show a form that
// pretends to authenticate against something that doesn't exist.
vi.mock('@/config/env', () => ({
  env: { apiBaseUrl: 'http://test.invalid', mockAuthEnabled: false },
}))

describe('LoginPage (mock-auth disabled)', () => {
  it('shows an honest "auth unavailable" message instead of a login form', async () => {
    const { Component: LoginPage } = await import('./LoginPage')

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.getByText(/isn't available yet/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Analyst name')).not.toBeInTheDocument()
  })
})
