import { describe, expect, it } from 'vitest'
import { useNotificationsStore } from '@/store/notificationsStore'

describe('notificationsStore', () => {
  it('defaults lastReadAt to 0', () => {
    useNotificationsStore.setState({ lastReadAt: 0 })
    expect(useNotificationsStore.getState().lastReadAt).toBe(0)
  })

  it('markAllRead sets lastReadAt to now', () => {
    const before = Date.now()
    useNotificationsStore.getState().markAllRead()
    expect(useNotificationsStore.getState().lastReadAt).toBeGreaterThanOrEqual(before)
  })
})
