import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AlertBanner } from './alert-banner'

describe('AlertBanner', () => {
  it('renders the title and description', () => {
    render(
      <AlertBanner
        severity="critical"
        title="Lateral pivot detected"
        description="Machine:C1042 -> Machine:C1043"
      />,
    )

    expect(screen.getByText('Lateral pivot detected')).toBeInTheDocument()
    expect(screen.getByText('Machine:C1042 -> Machine:C1043')).toBeInTheDocument()
  })

  it('has role=alert for screen readers', () => {
    render(<AlertBanner severity="high" title="Anomaly detected" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('does not render a dismiss button when onDismiss is omitted', () => {
    render(<AlertBanner severity="info" title="Motif reset" />)
    expect(screen.queryByRole('button', { name: 'Dismiss alert' })).not.toBeInTheDocument()
  })

  it('calls onDismiss when the dismiss button is clicked', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<AlertBanner severity="medium" title="Prune rate elevated" onDismiss={onDismiss} />)

    await user.click(screen.getByRole('button', { name: 'Dismiss alert' }))

    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
