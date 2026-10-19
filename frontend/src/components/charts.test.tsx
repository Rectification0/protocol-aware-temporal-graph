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
    expect(screen.getByLabelText('Tue, 01: 4')).toBeInTheDocument()
  })
})
