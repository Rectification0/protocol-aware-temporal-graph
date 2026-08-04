import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DateRangePicker } from './date-range-picker'

describe('DateRangePicker', () => {
  it('shows a placeholder when no range is selected', () => {
    render(<DateRangePicker value={undefined} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: /pick a date range/i })).toBeInTheDocument()
  })

  it('opens the popover with preset options and the calendar', async () => {
    const user = userEvent.setup()
    render(<DateRangePicker value={undefined} onChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /pick a date range/i }))

    expect(await screen.findByRole('button', { name: 'Last hour' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Last 24 hours' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toBeInTheDocument()
  })

  it('calls onChange with a computed range and closes when a preset is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DateRangePicker value={undefined} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /pick a date range/i }))
    await user.click(await screen.findByRole('button', { name: 'Last 24 hours' }))

    expect(onChange).toHaveBeenCalledOnce()
    const range = onChange.mock.calls[0][0]
    expect(range.to.getTime() - range.from.getTime()).toBeCloseTo(24 * 60 * 60 * 1000, -3)
  })

  it('formats a selected range in the trigger button', () => {
    render(
      <DateRangePicker
        value={{ from: new Date('2026-01-01'), to: new Date('2026-01-08') }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /2026/ })).toBeInTheDocument()
  })
})
