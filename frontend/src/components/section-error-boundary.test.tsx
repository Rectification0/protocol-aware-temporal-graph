import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SectionErrorBoundary } from '@/components/section-error-boundary'

// Module-level switch so a test can make the child stop throwing before
// clicking Retry / changing `resetKey`, the way a transient render bug
// (e.g. one malformed payload, since replaced) would recover.
let shouldThrow = true

function Bomb() {
  if (shouldThrow) throw new Error('kaboom')
  return <p>recovered</p>
}

beforeEach(() => {
  shouldThrow = true
  // React logs every caught render error (and our componentDidCatch does
  // too) -- expected noise here, not a failure signal.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SectionErrorBoundary (F16.9)', () => {
  it('renders its children when nothing throws', () => {
    render(
      <SectionErrorBoundary label="Threat trends">
        <p>chart</p>
      </SectionErrorBoundary>,
    )

    expect(screen.getByText('chart')).toBeInTheDocument()
  })

  it('contains a crash to its own panel, leaving siblings rendered', () => {
    render(
      <div>
        <SectionErrorBoundary label="Threat trends">
          <Bomb />
        </SectionErrorBoundary>
        <SectionErrorBoundary label="Threat severity">
          <p>sibling still here</p>
        </SectionErrorBoundary>
      </div>,
    )

    expect(screen.getByText('Threat trends failed to load')).toBeInTheDocument()
    expect(screen.getByText('kaboom')).toBeInTheDocument()
    expect(screen.getByText('sibling still here')).toBeInTheDocument()
  })

  it('re-renders its children on Retry', () => {
    render(
      <SectionErrorBoundary label="Threat trends">
        <Bomb />
      </SectionErrorBoundary>,
    )

    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(screen.getByText('recovered')).toBeInTheDocument()
  })

  it('clears a caught error when resetKey changes', () => {
    const { rerender } = render(
      <SectionErrorBoundary label="Risk score" resetKey="User:alice">
        <Bomb />
      </SectionErrorBoundary>,
    )
    expect(screen.getByText('Risk score failed to load')).toBeInTheDocument()

    shouldThrow = false
    rerender(
      <SectionErrorBoundary label="Risk score" resetKey="User:bob">
        <Bomb />
      </SectionErrorBoundary>,
    )

    expect(screen.getByText('recovered')).toBeInTheDocument()
  })

  it('keeps showing the error when re-rendered with the same resetKey', () => {
    const { rerender } = render(
      <SectionErrorBoundary label="Risk score" resetKey="User:alice">
        <Bomb />
      </SectionErrorBoundary>,
    )

    shouldThrow = false
    rerender(
      <SectionErrorBoundary label="Risk score" resetKey="User:alice">
        <Bomb />
      </SectionErrorBoundary>,
    )

    expect(screen.getByText('Risk score failed to load')).toBeInTheDocument()
  })

  it('uses a custom fallback when one is given', () => {
    render(
      <SectionErrorBoundary
        label="Notifications"
        fallback={({ error, reset }) => (
          <button type="button" onClick={reset}>
            custom: {error.message}
          </button>
        )}
      >
        <Bomb />
      </SectionErrorBoundary>,
    )

    expect(screen.queryByText('Notifications failed to load')).not.toBeInTheDocument()
    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: 'custom: kaboom' }))
    expect(screen.getByText('recovered')).toBeInTheDocument()
  })
})
