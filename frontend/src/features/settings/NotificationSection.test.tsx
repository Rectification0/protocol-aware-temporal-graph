import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { NotificationSection } from '@/features/settings/NotificationSection'
import { ALERT_SEVERITIES } from '@/features/monitoring/logic'
import { useNotificationSettingsStore } from '@/store/notificationSettingsStore'

describe('NotificationSection', () => {
  beforeEach(() => {
    localStorage.clear()
    useNotificationSettingsStore.setState({ enabledSeverities: [...ALERT_SEVERITIES] })
  })

  it('renders a checked checkbox for every enabled severity', () => {
    render(<NotificationSection />)

    for (const severity of ALERT_SEVERITIES) {
      expect(screen.getByRole('checkbox', { name: new RegExp(severity, 'i') })).toBeChecked()
    }
  })

  it('unchecking a severity updates the store', async () => {
    const user = userEvent.setup()
    render(<NotificationSection />)

    await user.click(screen.getByRole('checkbox', { name: /low/i }))

    expect(useNotificationSettingsStore.getState().enabledSeverities).not.toContain('low')
  })
})
