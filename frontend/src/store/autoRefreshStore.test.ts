import { beforeEach, describe, expect, it } from 'vitest'
import { AUTO_REFRESH_INTERVAL_OPTIONS_MS, useAutoRefreshStore } from '@/store/autoRefreshStore'

describe('autoRefreshStore', () => {
  beforeEach(() => {
    useAutoRefreshStore.setState({ enabled: true, intervalMs: AUTO_REFRESH_INTERVAL_OPTIONS_MS[0] })
  })

  it('defaults to enabled at the shortest interval', () => {
    const state = useAutoRefreshStore.getState()
    expect(state.enabled).toBe(true)
    expect(state.intervalMs).toBe(AUTO_REFRESH_INTERVAL_OPTIONS_MS[0])
  })

  it('setEnabled toggles the flag', () => {
    useAutoRefreshStore.getState().setEnabled(false)
    expect(useAutoRefreshStore.getState().enabled).toBe(false)
  })

  it('setIntervalMs updates the interval', () => {
    useAutoRefreshStore.getState().setIntervalMs(AUTO_REFRESH_INTERVAL_OPTIONS_MS[2])
    expect(useAutoRefreshStore.getState().intervalMs).toBe(AUTO_REFRESH_INTERVAL_OPTIONS_MS[2])
  })
})
