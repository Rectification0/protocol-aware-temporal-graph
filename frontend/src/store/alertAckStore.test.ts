import { beforeEach, describe, expect, it } from 'vitest'
import { useAlertAckStore } from '@/store/alertAckStore'

describe('alertAckStore', () => {
  beforeEach(() => {
    useAlertAckStore.setState({ ackedKeys: {} })
  })

  it('is not acked by default', () => {
    expect(useAlertAckStore.getState().isAcked('anomaly', 'User:alice:100')).toBe(false)
  })

  it('markAcked flips isAcked for that exact type/ref pair only', () => {
    useAlertAckStore.getState().markAcked('anomaly', 'User:alice:100')

    expect(useAlertAckStore.getState().isAcked('anomaly', 'User:alice:100')).toBe(true)
    expect(useAlertAckStore.getState().isAcked('anomaly', 'User:bob:100')).toBe(false)
    expect(useAlertAckStore.getState().isAcked('motif_completion', 'User:alice:100')).toBe(false)
  })
})
