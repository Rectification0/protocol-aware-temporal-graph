import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { toLogRow } from '@/features/logs/logic'
import { RawLogDialog } from '@/features/logs/raw-log-dialog'

describe('RawLogDialog (F11.4)', () => {
  it('renders nothing while no row is selected', () => {
    render(<RawLogDialog row={null} onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the selected record verbatim as JSON', () => {
    const row = toLogRow({
      type: 'prune',
      logged_at: 1_700_000_000,
      edge_id: 'e1',
      src: 'User:alice',
      dst: 'Machine:C1',
      w_at_prune: 0.01,
    })
    render(<RawLogDialog row={row} onOpenChange={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Raw log record' })).toBeInTheDocument()
    expect(screen.getByText(/"edge_id": "e1"/)).toBeInTheDocument()
    expect(screen.getByText(/"src": "User:alice"/)).toBeInTheDocument()
  })
})
