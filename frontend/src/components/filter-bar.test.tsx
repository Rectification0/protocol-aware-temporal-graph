import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FilterBar } from './filter-bar'

describe('FilterBar', () => {
  it('renders nothing when there are no filters or children', () => {
    const { container } = render(<FilterBar filters={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a chip per filter', () => {
    render(
      <FilterBar
        filters={[
          { id: '1', label: 'protocol: RDP', onRemove: vi.fn() },
          { id: '2', label: 'severity: critical', onRemove: vi.fn() },
        ]}
      />,
    )

    expect(screen.getByText('protocol: RDP')).toBeInTheDocument()
    expect(screen.getByText('severity: critical')).toBeInTheDocument()
  })

  it('calls onRemove when a chip is removed', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<FilterBar filters={[{ id: '1', label: 'protocol: RDP', onRemove }]} />)

    await user.click(screen.getByRole('button', { name: 'Remove filter: protocol: RDP' }))

    expect(onRemove).toHaveBeenCalledOnce()
  })

  it('calls onClearAll when "Clear all" is clicked', async () => {
    const user = userEvent.setup()
    const onClearAll = vi.fn()
    render(
      <FilterBar
        filters={[{ id: '1', label: 'protocol: RDP', onRemove: vi.fn() }]}
        onClearAll={onClearAll}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Clear all' }))

    expect(onClearAll).toHaveBeenCalledOnce()
  })
})
