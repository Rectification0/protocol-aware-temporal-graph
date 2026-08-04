import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BackendPendingState, EmptyState, NoResultsState } from './empty-state'

describe('EmptyState', () => {
  it('renders the title and description', () => {
    render(<EmptyState title="No detections yet" description="Detections will appear here." />)

    expect(screen.getByText('No detections yet')).toBeInTheDocument()
    expect(screen.getByText('Detections will appear here.')).toBeInTheDocument()
  })

  it('renders an action node when given', () => {
    render(<EmptyState title="Nothing here" action={<button type="button">Refresh</button>} />)
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
  })
})

describe('NoResultsState', () => {
  it('renders a no-results message', () => {
    render(<NoResultsState />)
    expect(screen.getByText('No results')).toBeInTheDocument()
  })
})

describe('BackendPendingState', () => {
  it('names the tracked backend gap by default', () => {
    render(<BackendPendingState taskRef="F0.12" />)

    expect(screen.getByText('Not available yet')).toBeInTheDocument()
    expect(screen.getByText(/tasks\.md F0\.12/)).toBeInTheDocument()
  })

  it('allows a custom description', () => {
    render(<BackendPendingState taskRef="F0.13" description="Custom explanation." />)
    expect(screen.getByText('Custom explanation.')).toBeInTheDocument()
  })
})
