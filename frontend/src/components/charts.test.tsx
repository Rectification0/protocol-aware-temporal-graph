import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CategoryBarChart, HeatmapChart } from './charts'

// The Recharts-backed charts themselves are unit-tested in
// recharts-charts.test.tsx; this covers the F16.8 lazy facade.
describe('chart facade', () => {
  it('shows a same-height skeleton, then the lazily loaded chart', async () => {
    const { container } = render(
      <CategoryBarChart
        data={[{ machine: 'Machine:C1', count: 3 }]}
        categoryKey="machine"
        valueKey="count"
        label="Detections"
        height={200}
      />,
    )

    expect(container.querySelector('.animate-pulse')).toHaveStyle({ height: '200px' })
    expect(container.querySelector('[data-chart]')).toBeNull()

    await waitFor(() => expect(container.querySelector('[data-chart]')).toBeTruthy())
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('HeatmapChart renders eagerly (no Recharts) with an accessible label per cell', () => {
    render(
      <HeatmapChart
        rowLabels={['Mon', 'Tue']}
        columnLabels={['00', '01']}
        values={[
          [1, 2],
          [3, 4],
        ]}
      />,
    )
    expect(screen.getByLabelText('Mon, 00: 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Tue, 01: 4 (busiest)')).toBeInTheDocument()
  })

  it('HeatmapChart bins magnitude, rings the busiest cell, and shows a scale legend', () => {
    const { container } = render(
      <HeatmapChart rowLabels={['Mon']} columnLabels={['00', '01', '02']} values={[[0, 1, 8]]} />,
    )

    const empty = screen.getByLabelText('Mon, 00: 0')
    const low = screen.getByLabelText('Mon, 01: 1')
    const peak = screen.getByLabelText('Mon, 02: 8 (busiest)')
    expect(empty).toHaveStyle({ backgroundColor: 'var(--muted)' })
    expect(low).toHaveStyle({ backgroundColor: 'var(--heat-1)' })
    expect(peak).toHaveStyle({ backgroundColor: 'var(--heat-4)' })
    expect(container.querySelectorAll('[data-peak]')).toHaveLength(1)
    // Legend: "none", four bins (1-2 ... 7-8) and the busiest marker.
    expect(screen.getByText('none')).toBeInTheDocument()
    expect(screen.getByText('7–8')).toBeInTheDocument()
    expect(screen.getByText('busiest')).toBeInTheDocument()
  })

  it('HeatmapChart shows no legend for an all-zero grid', () => {
    render(<HeatmapChart rowLabels={['Mon']} columnLabels={['00']} values={[[0]]} />)
    expect(screen.queryByText('none')).not.toBeInTheDocument()
  })
})
