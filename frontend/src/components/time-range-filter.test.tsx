import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { TimeRangeFilter } from '@/components/time-range-filter'
import { useTimeRangeStore } from '@/store/timeRangeStore'

describe('TimeRangeFilter', () => {
  it("renders the store's current range in the trigger button", () => {
    useTimeRangeStore.setState({ range: { start: 1735689600, end: 1735776000 } }) // 2025-01-01 -> 2025-01-02 UTC
    render(<TimeRangeFilter />)

    expect(screen.getByRole('button', { name: /2025/ })).toBeInTheDocument()
  })

  it('updates the store when a preset is clicked', async () => {
    const user = userEvent.setup()
    render(<TimeRangeFilter />)

    await user.click(screen.getByRole('button', { name: /pick a date range|\d{4}/i }))
    await user.click(await screen.findByRole('button', { name: 'Last 24 hours' }))

    const { range } = useTimeRangeStore.getState()
    expect(range.end - range.start).toBeCloseTo(24 * 60 * 60, -1)
  })
})
