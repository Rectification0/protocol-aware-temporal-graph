import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { useAuthStore } from '@/store/authStore'

// F16.4: F2.4/F3.2's auth gate in isolation (router.test.tsx covers it
// end-to-end through the real route tree).
function LoginProbe() {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  return <p>login page (from: {from ?? 'none'})</p>
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: <ProtectedRoute />,
        children: [{ path: '/detections', element: <p>protected content</p> }],
      },
      { path: '/login', element: <LoginProbe /> },
    ],
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
}

beforeEach(() => {
  useAuthStore.setState({ session: null })
})

describe('ProtectedRoute', () => {
  it('redirects to /login without a session, remembering where the user was headed', async () => {
    renderAt('/detections')

    expect(await screen.findByText('login page (from: /detections)')).toBeInTheDocument()
    expect(screen.queryByText('protected content')).not.toBeInTheDocument()
  })

  it('redirects when the session has expired', async () => {
    useAuthStore.setState({ session: { analyst: 'alice', expiresAt: Date.now() - 1 } })
    renderAt('/detections')

    expect(await screen.findByText(/login page/)).toBeInTheDocument()
  })

  it('renders the child route with a valid session', async () => {
    useAuthStore.getState().login('alice')
    renderAt('/detections')

    expect(await screen.findByText('protected content')).toBeInTheDocument()
  })
})
