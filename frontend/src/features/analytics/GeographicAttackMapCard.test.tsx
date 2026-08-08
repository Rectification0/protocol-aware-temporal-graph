import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GeographicAttackMapCard } from '@/features/analytics/GeographicAttackMapCard'

describe('GeographicAttackMapCard', () => {
  it('names the F0.14 blocker rather than showing fake pins', () => {
    render(<GeographicAttackMapCard />)

    expect(screen.getByText('Geographic Attack Map')).toBeInTheDocument()
    expect(screen.getByText(/F0.14/)).toBeInTheDocument()
    expect(screen.getByText('Not available yet')).toBeInTheDocument()
  })
})
