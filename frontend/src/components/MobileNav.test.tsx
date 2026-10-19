import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { MobileNav } from '@/components/MobileNav'
import { Sidebar } from '@/components/Sidebar'

function Where() {
  return <p>at {useLocation().pathname}</p>
}

function renderNav() {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <>
            <MobileNav />
            <Where />
          </>
        ),
      },
    ],
    { initialEntries: ['/'] },
  )
  render(<RouterProvider router={router} />)
}

describe('MobileNav (F16.1)', () => {
  it('opens a drawer with every nav link, and closes it after navigating', async () => {
    const user = userEvent.setup()
    renderNav()

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }))
    const drawer = await screen.findByRole('dialog', { name: 'T-GNN SOC Dashboard' })
    expect(drawer).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Detections' }))

    expect(screen.getByText('at /detections')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes on Escape and returns focus to the menu button (F16.3)', async () => {
    const user = userEvent.setup()
    renderNav()
    const trigger = screen.getByRole('button', { name: 'Open navigation menu' })

    await user.click(trigger)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('is hidden from md up, where the persistent Sidebar takes over', () => {
    renderNav()
    expect(screen.getByRole('button', { name: 'Open navigation menu' })).toHaveClass('md:hidden')
  })
})

describe('Sidebar (F16.1)', () => {
  it('is desktop-only', () => {
    const router = createMemoryRouter([{ path: '*', element: <Sidebar /> }])
    render(<RouterProvider router={router} />)
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toHaveClass(
      'hidden',
      'md:block',
    )
  })
})
