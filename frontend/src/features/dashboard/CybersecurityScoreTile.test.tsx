import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CybersecurityScoreTile } from '@/features/dashboard/CybersecurityScoreTile'

describe('CybersecurityScoreTile', () => {
  it('names the F0.12 backend gap instead of fabricating a score', () => {
    render(<CybersecurityScoreTile />)

    expect(screen.getByText('Cybersecurity Score')).toBeInTheDocument()
    expect(screen.getByText(/F0\.12/)).toBeInTheDocument()
  })
})
