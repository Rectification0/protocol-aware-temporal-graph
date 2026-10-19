import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Sidebar } from '@/components/Sidebar'
import { NAV_ROUTES } from '@/config/routes'

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>,
  )
}

describe('Sidebar (F5.2)', () => {
  it('renders one link per NAV_ROUTES entry, pointing at its path', () => {
    renderAt('/')

    for (const route of NAV_ROUTES) {
      expect(screen.getByRole('link', { name: route.label })).toHaveAttribute('href', route.path)
    }
  })

  it('marks only the current route active', () => {
    renderAt('/analytics')

    expect(screen.getByRole('link', { name: 'Analytics' })).toHaveAttribute('aria-current', 'page')
    // `/` uses `end`, so it must not also match every nested path.
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')
  })

  it('keeps Users active on an /investigation/:entityId detail page', () => {
    renderAt('/investigation/User%3Aalice')

    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page')
  })
})
