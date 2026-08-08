import { beforeEach, describe, expect, it } from 'vitest'
import { AUTO_REFRESH_INTERVAL_OPTIONS_MS, useAutoRefreshStore } from '@/store/autoRefreshStore'

describe('autoRefreshStore', () => {
  beforeEach(() => {
    localStorage.clear()
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

  it('persists changes to localStorage (F15.6)', () => {
    useAutoRefreshStore.getState().setEnabled(false)

    const raw = localStorage.getItem('t-gnn-auto-refresh')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).state.enabled).toBe(false)
  })
})
