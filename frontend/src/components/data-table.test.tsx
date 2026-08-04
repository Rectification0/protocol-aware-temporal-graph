import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ColumnDef } from '@tanstack/react-table'
import { describe, expect, it } from 'vitest'
import { createSelectionColumn, DataTable } from './data-table'

interface Row {
  id: string
  name: string
  score: number
}

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'score', header: 'Score' },
]

const rows: Row[] = [
  { id: '1', name: 'User:alice', score: 3.2 },
  { id: '2', name: 'User:bob', score: 9.1 },
  { id: '3', name: 'User:carol', score: 1.5 },
]

describe('DataTable', () => {
  it('renders rows and headers', () => {
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} />)

    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText('User:alice')).toBeInTheDocument()
    expect(screen.getByText('User:bob')).toBeInTheDocument()
    expect(screen.getByText('User:carol')).toBeInTheDocument()
  })

  it('shows the empty message when there are no rows', () => {
    render(<DataTable columns={columns} data={[]} emptyMessage="No detections found." />)

    expect(screen.getByText('No detections found.')).toBeInTheDocument()
  })

  it('sorts rows when a sortable header is clicked', async () => {
    const user = userEvent.setup()
    render(<DataTable columns={columns} data={rows} getRowId={(r) => r.id} />)
    const scoreColumn = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[1].textContent)

    // TanStack Table defaults numeric columns to descending-first, so
    // assert both directions appear across the two clicks rather than
    // assuming which one comes first.
    await user.click(screen.getByRole('button', { name: /score/i }))
    const afterFirstClick = scoreColumn()

    await user.click(screen.getByRole('button', { name: /score/i }))
    const afterSecondClick = scoreColumn()

    expect([afterFirstClick, afterSecondClick]).toContainEqual(['1.5', '3.2', '9.1'])
    expect([afterFirstClick, afterSecondClick]).toContainEqual(['9.1', '3.2', '1.5'])
  })

  it('renders a row-selection checkbox column and reports selection', async () => {
    const user = userEvent.setup()
    let selected: Row[] = []
    const selectionColumns = [createSelectionColumn<Row>(), ...columns]

    function Wrapper() {
      return (
        <DataTable
          columns={selectionColumns}
          data={rows}
          getRowId={(r) => r.id}
          enableRowSelection
          onRowSelectionChange={(updater) => {
            const next = typeof updater === 'function' ? updater({}) : updater
            selected = rows.filter((r) => next[r.id])
          }}
        />
      )
    }
    render(<Wrapper />)

    await user.click(screen.getAllByRole('checkbox', { name: 'Select row' })[0])

    expect(selected).toEqual([rows[0]])
  })

  it('renders skeleton rows while loading, not the data', () => {
    render(<DataTable columns={columns} data={rows} loading />)

    expect(screen.queryByText('User:alice')).not.toBeInTheDocument()
  })
})
