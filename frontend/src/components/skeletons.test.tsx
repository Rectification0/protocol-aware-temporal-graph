import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChartSkeleton, ListSkeleton, StatCardSkeleton } from './skeletons'

describe('skeletons', () => {
  it('StatCardSkeleton renders without throwing', () => {
    const { container } = render(<StatCardSkeleton />)
    expect(container.firstChild).toBeTruthy()
  })

  it('ChartSkeleton renders at the given height', () => {
    const { container } = render(<ChartSkeleton height={200} />)
    expect((container.firstChild as HTMLElement).style.height).toBe('200px')
  })

  it('ListSkeleton renders the requested number of rows', () => {
    const { container } = render(<ListSkeleton rows={3} />)
    expect(container.firstChild?.childNodes.length).toBe(3)
  })
})
