import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary'

function renderThrowing(thrown: unknown, inShell = false) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        loader: () => {
          throw thrown
        },
        element: <p>unreachable</p>,
        errorElement: <RouteErrorBoundary inShell={inShell} />,
      },
    ],
    { initialEntries: ['/'] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RouteErrorBoundary (F2.5, F16.9)', () => {
  it('shows a thrown Error message with a way back to the Overview', async () => {
    renderThrowing(new Error('chunk failed'))

    expect(await screen.findByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByText('chunk failed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Overview' })).toHaveAttribute('href', '/')
  })

  it('formats a thrown route error response as status + text', async () => {
    renderThrowing(new Response(null, { status: 503, statusText: 'Service Unavailable' }))

    expect(await screen.findByText('503 Service Unavailable')).toBeInTheDocument()
  })

  it('falls back to a generic message for a non-Error throw', async () => {
    renderThrowing('just a string')

    expect(await screen.findByText('Unknown error')).toBeInTheDocument()
  })

  it('fills the viewport at the root but not inside the shell', async () => {
    const root = renderThrowing(new Error('x'))
    await screen.findByText('Something went wrong')
    expect(root.container.firstElementChild).toHaveClass('min-h-svh')
    root.unmount()

    const inShell = renderThrowing(new Error('x'), true)
    await screen.findByText('Something went wrong')
    expect(inShell.container.firstElementChild).not.toHaveClass('min-h-svh')
  })
})
