import { beforeEach, describe, expect, it } from 'vitest'
import { type LiveStreamEvent, useLiveStreamStore } from '@/store/liveStreamStore'

function pruneEvent(n: number): LiveStreamEvent {
  return { type: 'prune', data: { type: 'prune', logged_at: n }, receivedAt: n }
}

beforeEach(() => {
  useLiveStreamStore.setState({
    status: 'idle',
    events: [],
    lastHeartbeatAt: null,
    lastError: null,
  })
})

describe('liveStreamStore (F4.6)', () => {
  it('prepends events, newest first', () => {
    const { pushEvent } = useLiveStreamStore.getState()
    pushEvent(pruneEvent(1))
    pushEvent(pruneEvent(2))

    expect(useLiveStreamStore.getState().events.map((e) => e.receivedAt)).toEqual([2, 1])
  })

  it('caps the buffer at 200, dropping the oldest', () => {
    const { pushEvent } = useLiveStreamStore.getState()
    for (let i = 1; i <= 205; i++) pushEvent(pruneEvent(i))

    const { events } = useLiveStreamStore.getState()
    expect(events).toHaveLength(200)
    expect(events[0].receivedAt).toBe(205)
    expect(events.at(-1)?.receivedAt).toBe(6)
  })

  it('clear() drops events and the last error but keeps connection status', () => {
    const state = useLiveStreamStore.getState()
    state.setStatus('open')
    state.pushEvent(pruneEvent(1))
    state.recordError('boom')
    state.recordHeartbeat(42)

    useLiveStreamStore.getState().clear()

    expect(useLiveStreamStore.getState()).toMatchObject({
      status: 'open',
      events: [],
      lastError: null,
      lastHeartbeatAt: 42,
    })
  })
})
