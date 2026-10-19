import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LoadErrorNotice } from '@/components/load-error-notice'

describe('LoadErrorNotice (F16.9)', () => {
  it('renders nothing when every source loaded', () => {
    const { container } = render(<LoadErrorNotice failures={[false, null, undefined]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('names each failed source with its error, plus the partial-data caveat', () => {
    render(
      <LoadErrorNotice
        failures={[
          { label: 'Anomaly scores', error: new Error('503') },
          false,
          { label: 'Analyst dispositions', error: new Error('timeout') },
        ]}
        partial="Showing partial data."
      />,
    )

    const notice = screen.getByRole('alert')
    expect(notice).toHaveTextContent('Anomaly scores unavailable: 503')
    expect(notice).toHaveTextContent('Analyst dispositions unavailable: timeout')
    expect(notice).toHaveTextContent('Showing partial data.')
  })
})
