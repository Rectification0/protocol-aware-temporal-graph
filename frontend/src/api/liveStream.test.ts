import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveStreamManager, type EventSourceFactory, type EventSourceLike } from '@/api/liveStream'
import { useLiveStreamStore } from '@/store/liveStreamStore'

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = []
  url: string
  closed = false
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  listeners = new Map<string, (event: MessageEvent) => void>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, listener)
  }

  close(): void {
    this.closed = true
  }

  emit(type: string, data: unknown): void {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent)
  }
}

function factory(): EventSourceFactory {
  return (url) => new FakeEventSource(url)
}

describe('LiveStreamManager', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.useFakeTimers()
    FakeEventSource.instances = []
    queryClient = new QueryClient()
    vi.spyOn(queryClient, 'invalidateQueries')
    useLiveStreamStore.setState({
      status: 'idle',
      events: [],
      lastHeartbeatAt: null,
      lastError: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('connects and reports status transitions', () => {
    const manager = new LiveStreamManager(
      'http://api.test/api/stream/events',
      queryClient,
      factory(),
    )
    manager.start()

    expect(useLiveStreamStore.getState().status).toBe('connecting')

    FakeEventSource.instances[0].onopen?.(new Event('open'))
    expect(useLiveStreamStore.getState().status).toBe('open')

    manager.stop()
    expect(useLiveStreamStore.getState().status).toBe('closed')
    expect(FakeEventSource.instances[0].closed).toBe(true)
  })

  it('pushes motif_completion events into the store and invalidates the matching query key', () => {
    const manager = new LiveStreamManager(
      'http://api.test/api/stream/events',
      queryClient,
      factory(),
    )
    manager.start()

    FakeEventSource.instances[0].emit('motif_completion', {
      id: 1,
      motif_name: 'lateral_pivot',
      chain_key: 'Machine:C1',
      matched_edges: ['e1', 'e2'],
      completed_at: 100,
      confidence: 1,
    })

    expect(useLiveStreamStore.getState().events).toHaveLength(1)
    expect(useLiveStreamStore.getState().events[0].type).toBe('motif_completion')
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['motifs', 'completions'],
    })

    manager.stop()
  })

  it('records heartbeats without adding them to the event feed', () => {
    const manager = new LiveStreamManager(
      'http://api.test/api/stream/events',
      queryClient,
      factory(),
    )
    manager.start()

    FakeEventSource.instances[0].emit('heartbeat', { t: 12345 })

    expect(useLiveStreamStore.getState().lastHeartbeatAt).toBe(12345)
    expect(useLiveStreamStore.getState().events).toHaveLength(0)

    manager.stop()
  })

  it('records a server-side error event distinct from a transport failure', () => {
    const manager = new LiveStreamManager(
      'http://api.test/api/stream/events',
      queryClient,
      factory(),
    )
    manager.start()

    FakeEventSource.instances[0].emit('error', { message: 'Postgres unavailable' })

    expect(useLiveStreamStore.getState().lastError).toBe('Postgres unavailable')
    expect(useLiveStreamStore.getState().status).toBe('connecting') // connection itself is still alive

    manager.stop()
  })

  it('reconnects with exponential backoff on a transport failure, and resets it after a clean open', () => {
    const manager = new LiveStreamManager(
      'http://api.test/api/stream/events',
      queryClient,
      factory(),
    )
    manager.start()

    FakeEventSource.instances[0].onerror?.(new Event('error'))
    expect(useLiveStreamStore.getState().status).toBe('reconnecting')
    expect(FakeEventSource.instances).toHaveLength(1)

    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(2)

    FakeEventSource.instances[1].onerror?.(new Event('error'))
    vi.advanceTimersByTime(1999)
    expect(FakeEventSource.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(3) // second backoff was 2s, not another 1s

    FakeEventSource.instances[2].onopen?.(new Event('open'))
    FakeEventSource.instances[2].onerror?.(new Event('error'))
    vi.advanceTimersByTime(1000)
    expect(FakeEventSource.instances).toHaveLength(4) // backoff reset to 1s after the successful open

    manager.stop()
  })

  it('does not reconnect after stop() is called', () => {
    const manager = new LiveStreamManager(
      'http://api.test/api/stream/events',
      queryClient,
      factory(),
    )
    manager.start()
    manager.stop()

    FakeEventSource.instances[0].onerror?.(new Event('error'))
    vi.advanceTimersByTime(60_000)

    expect(FakeEventSource.instances).toHaveLength(1)
  })
})
