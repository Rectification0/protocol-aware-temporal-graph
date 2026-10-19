import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Component as NotFoundPage } from '@/pages/NotFoundPage'

describe('NotFoundPage (F2.5)', () => {
  it('explains the miss and links back to the Overview', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('Page not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Overview' })).toHaveAttribute('href', '/')
  })
})
