import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatCard } from './stat-card'

describe('StatCard', () => {
  it('renders the label and value', () => {
    render(<StatCard label="Active graph size" value="12,345" />)

    expect(screen.getByText('Active graph size')).toBeInTheDocument()
    expect(screen.getByText('12,345')).toBeInTheDocument()
  })

  it('renders a skeleton instead of the value while loading', () => {
    render(<StatCard label="Active graph size" value="12,345" loading />)

    expect(screen.queryByText('12,345')).not.toBeInTheDocument()
  })

  it('renders the unavailable message instead of the value', () => {
    render(
      <StatCard
        label="Company security score"
        value="N/A"
        unavailable="Not available yet (tasks.md F0.12)"
      />,
    )

    expect(screen.getByText('Not available yet (tasks.md F0.12)')).toBeInTheDocument()
    expect(screen.queryByText('N/A')).not.toBeInTheDocument()
  })

  it('renders a trend label', () => {
    render(
      <StatCard
        label="Prune rate"
        value="4.2/s"
        trend={{ direction: 'up', label: '+12% since yesterday', tone: 'negative' }}
      />,
    )

    expect(screen.getByText('+12% since yesterday')).toBeInTheDocument()
  })
})
