import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CategoryBarChart, DonutChart, HeatmapChart, TimeSeriesChart } from './charts'

const timeSeriesData = [
  { t: '00:00', motifs: 2, anomalies: 1 },
  { t: '01:00', motifs: 4, anomalies: 3 },
]

const barData = [
  { machine: 'Machine:C1042', count: 12 },
  { machine: 'Machine:C1043', count: 30 },
]

const donutData = [
  { name: 'lateral_pivot', value: 8 },
  { name: 'admin_share_escalation', value: 3 },
]

describe('chart wrappers', () => {
  it('TimeSeriesChart renders without throwing', () => {
    const { container } = render(
      <TimeSeriesChart
        data={timeSeriesData}
        xKey="t"
        series={[
          { key: 'motifs', label: 'Motif completions' },
          { key: 'anomalies', label: 'Anomalies' },
        ]}
      />,
    )
    expect(container.querySelector('[data-chart]')).toBeTruthy()
  })

  it('CategoryBarChart renders without throwing', () => {
    const { container } = render(
      <CategoryBarChart data={barData} categoryKey="machine" valueKey="count" label="Detections" />,
    )
    expect(container.querySelector('[data-chart]')).toBeTruthy()
  })

  it('DonutChart renders without throwing', () => {
    const { container } = render(<DonutChart data={donutData} nameKey="name" valueKey="value" />)
    expect(container.querySelector('[data-chart]')).toBeTruthy()
  })

  it('HeatmapChart renders a cell per row/column with an accessible label', () => {
    const { getByLabelText } = render(
      <HeatmapChart
        rowLabels={['Mon', 'Tue']}
        columnLabels={['00', '01']}
        values={[
          [1, 2],
          [3, 4],
        ]}
      />,
    )
    expect(getByLabelText('Mon, 00: 1')).toBeInTheDocument()
    expect(getByLabelText('Tue, 01: 4')).toBeInTheDocument()
  })
})
