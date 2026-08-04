import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SearchBar } from './search-bar'

describe('SearchBar', () => {
  it('updates the visible input immediately without waiting for the debounce', async () => {
    const user = userEvent.setup()
    render(<SearchBar value="" onChange={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('Search...'), 'lateral')

    expect(screen.getByPlaceholderText('Search...')).toHaveValue('lateral')
  })

  it('shows a clear button once there is a value and clears it on click', () => {
    const onChange = vi.fn()
    render(<SearchBar value="" onChange={onChange} />)

    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(screen.getByPlaceholderText('Search...')).toHaveValue('')
  })

  it('calls onChange only after the debounce delay', async () => {
    // fireEvent (synchronous) rather than userEvent here -- userEvent's
    // internal delay-based simulation deadlocks against
    // vi.useFakeTimers(), a known testing-library/vitest interaction
    // issue, not a bug in SearchBar itself.
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      render(<SearchBar value="" onChange={onChange} debounceMs={300} />)

      fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'abc' } })
      expect(onChange).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(300)
      expect(onChange).toHaveBeenLastCalledWith('abc')
    } finally {
      vi.useRealTimers()
    }
  })
})
