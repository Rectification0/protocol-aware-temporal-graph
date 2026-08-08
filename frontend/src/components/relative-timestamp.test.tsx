import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RelativeTimestamp } from './relative-timestamp'

describe('RelativeTimestamp', () => {
  it('renders a relative label with the absolute time in the title', () => {
    const seconds = Math.floor(Date.now() / 1000) - 3600
    render(<RelativeTimestamp seconds={seconds} />)

    const element = screen.getByText(/ago/)
    expect(element).toBeInTheDocument()
    expect(element).toHaveAttribute('title', new Date(seconds * 1000).toLocaleString())
  })
})
