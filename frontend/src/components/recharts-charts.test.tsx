import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CategoryBarChart, DonutChart, TimeSeriesChart } from './recharts-charts'

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
})
