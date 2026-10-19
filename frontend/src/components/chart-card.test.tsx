import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ChartCard } from '@/components/chart-card'

describe('ChartCard', () => {
  it('leads with the headline, unit and caption above the chart', () => {
    render(
      <ChartCard title="Threat Trends" headline="37" headlineUnit="attacks" caption="Sampled.">
        <p>chart body</p>
      </ChartCard>,
    )

    expect(screen.getByText('Threat Trends')).toBeInTheDocument()
    expect(screen.getByText('37')).toBeInTheDocument()
    expect(screen.getByText('attacks')).toBeInTheDocument()
    expect(screen.getByText('Sampled.')).toBeInTheDocument()
    expect(screen.getByText('chart body')).toBeInTheDocument()
  })

  it('colors a delta by whether the direction is good news, with text not color alone', () => {
    const { rerender } = render(
      <ChartCard
        title="t"
        headline="1"
        delta={{ direction: 'up', text: '+20% vs previous period', upIsGood: false }}
      >
        <p />
      </ChartCard>,
    )
    expect(screen.getByText('+20% vs previous period')).toHaveClass('text-status-error')

    rerender(
      <ChartCard
        title="t"
        headline="1"
        delta={{ direction: 'up', text: '+20% vs previous period', upIsGood: true }}
      >
        <p />
      </ChartCard>,
    )
    expect(screen.getByText('+20% vs previous period')).toHaveClass('text-status-success')

    rerender(
      <ChartCard
        title="t"
        headline="1"
        delta={{ direction: 'flat', text: 'No change vs previous period', upIsGood: false }}
      >
        <p />
      </ChartCard>,
    )
    expect(screen.getByText('No change vs previous period')).toHaveClass('text-muted-foreground')
  })

  it('toggles between the chart and its table twin', async () => {
    const user = userEvent.setup()
    render(
      <ChartCard
        title="Patterns"
        table={{ columns: ['Pattern', 'Count'], rows: [['lateral_pivot', 3]] }}
      >
        <p>chart body</p>
      </ChartCard>,
    )

    await user.click(screen.getByRole('button', { name: 'Show table' }))
    expect(screen.queryByText('chart body')).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Pattern' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'lateral_pivot' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show chart' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Show chart' }))
    expect(screen.getByText('chart body')).toBeInTheDocument()
  })

  it('has no table toggle when there is no table', () => {
    render(
      <ChartCard title="t">
        <p />
      </ChartCard>,
    )
    expect(screen.queryByRole('button', { name: 'Show table' })).not.toBeInTheDocument()
  })

  it('dims, rather than replaces, the last render while refreshing', () => {
    render(
      <ChartCard title="t" refreshing>
        <p>still here</p>
      </ChartCard>,
    )
    const body = screen.getByText('still here').parentElement!
    expect(body).toHaveClass('opacity-60')
    expect(body).toHaveAttribute('aria-busy', 'true')
  })
})
