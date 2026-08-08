import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { AutoRefreshControl } from '@/components/AutoRefreshControl'
import { AUTO_REFRESH_INTERVAL_OPTIONS_MS, useAutoRefreshStore } from '@/store/autoRefreshStore'

describe('AutoRefreshControl', () => {
  beforeEach(() => {
    useAutoRefreshStore.setState({ enabled: true, intervalMs: AUTO_REFRESH_INTERVAL_OPTIONS_MS[0] })
  })

  it('reflects the store default: enabled, checked', () => {
    render(<AutoRefreshControl />)

    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('toggles the store when unchecked', async () => {
    const user = userEvent.setup()
    render(<AutoRefreshControl />)

    await user.click(screen.getByRole('checkbox'))

    expect(useAutoRefreshStore.getState().enabled).toBe(false)
  })

  it('disables the interval select when auto-refresh is off', () => {
    useAutoRefreshStore.setState({ enabled: false })

    render(<AutoRefreshControl />)

    expect(screen.getByRole('combobox')).toBeDisabled()
  })
})
