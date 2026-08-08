import { beforeEach, describe, expect, it } from 'vitest'
import { ALERT_SEVERITIES } from '@/features/monitoring/logic'
import { useNotificationSettingsStore } from '@/store/notificationSettingsStore'

describe('notificationSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useNotificationSettingsStore.setState({ enabledSeverities: [...ALERT_SEVERITIES] })
  })

  it('defaults to every severity enabled, matching pre-F15 behavior', () => {
    expect(useNotificationSettingsStore.getState().enabledSeverities).toEqual(ALERT_SEVERITIES)
  })

  it('setSeverityEnabled(false) removes a severity', () => {
    useNotificationSettingsStore.getState().setSeverityEnabled('low', false)
    expect(useNotificationSettingsStore.getState().enabledSeverities).not.toContain('low')
  })

  it('setSeverityEnabled(true) re-adds a severity without duplicating it', () => {
    useNotificationSettingsStore.getState().setSeverityEnabled('low', false)
    useNotificationSettingsStore.getState().setSeverityEnabled('low', true)
    useNotificationSettingsStore.getState().setSeverityEnabled('low', true)

    const { enabledSeverities } = useNotificationSettingsStore.getState()
    expect(enabledSeverities.filter((s) => s === 'low')).toHaveLength(1)
  })

  it('persists changes to localStorage (F15.6)', () => {
    useNotificationSettingsStore.getState().setSeverityEnabled('critical', false)

    const raw = localStorage.getItem('t-gnn-notification-settings')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).state.enabledSeverities).not.toContain('critical')
  })
})
