import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { env } from '@/config/env'
import { useLiveStreamStore } from '@/store/liveStreamStore'
import type { AuditRecordOut, EntityScoreOut, MotifCompletionOut, MotifResetOut } from '@/types/api'

// F4.6: SSE client wrapper for F0.10's `GET /api/stream/events`, consumed
// by F13's Live Monitoring page. Not mounted anywhere yet (F13 hasn't
// landed) -- same "built, installed, not yet wired into a page" posture
// this repo already takes with F1.4's Recharts/Zustand.
//
// Deliberately does NOT rely on native `EventSource` auto-reconnect: the
// browser's built-in retry uses a fixed ~3s delay with no backoff and no
// visible status, and stream.py's server-side polling loop plus Postgres
// graceful-degradation (F0's `require_postgres` posture) means a
// reconnect storm during an outage is a real possibility worth backing
// off from. So every `onerror` closes the connection and this class
// schedules its own reconnect with exponential backoff (1s -> 30s cap),
// resetting to 1s on the next successful `onopen`.

// A deliberately minimal duck-type of the real `EventSource` -- just what
// this module uses -- rather than `Pick<EventSource, ...>`, whose DOM-lib
// overloads (generic event-name-to-payload maps, `EventListenerObject`)
// are more than a fake test double needs to implement.
export interface EventSourceLike {
  close(): void
  addEventListener(type: string, listener: (event: MessageEvent) => void): void
  onopen: ((event: Event) => void) | null
  onerror: ((event: Event) => void) | null
}
export type EventSourceFactory = (url: string) => EventSourceLike

const INITIAL_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000

function defaultEventSourceFactory(url: string): EventSourceLike {
  return new EventSource(url)
}

export class LiveStreamManager {
  private readonly url: string
  private readonly queryClient: QueryClient
  private readonly factory: EventSourceFactory
  private es: EventSourceLike | null = null
  private backoff = INITIAL_BACKOFF_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = true

  constructor(
    url: string,
    queryClient: QueryClient,
    factory: EventSourceFactory = defaultEventSourceFactory,
  ) {
    this.url = url
    this.queryClient = queryClient
    this.factory = factory
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.es?.close()
    this.es = null
    useLiveStreamStore.getState().setStatus('closed')
  }

  private connect(): void {
    useLiveStreamStore
      .getState()
      .setStatus(this.backoff === INITIAL_BACKOFF_MS ? 'connecting' : 'reconnecting')

    const es = this.factory(this.url)
    this.es = es

    es.onopen = () => {
      this.backoff = INITIAL_BACKOFF_MS
      useLiveStreamStore.getState().setStatus('open')
    }

    // Transport-level failure (connection dropped) -- distinct from the
    // server's own named `error` SSE event handled below, which reports a
    // Postgres hiccup mid-poll while the connection itself stays alive.
    es.onerror = () => {
      es.close()
      if (this.stopped) return
      useLiveStreamStore.getState().setStatus('reconnecting')
      const delay = this.backoff
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
      this.reconnectTimer = setTimeout(() => this.connect(), delay)
    }

    es.addEventListener('motif_completion', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as MotifCompletionOut
      useLiveStreamStore
        .getState()
        .pushEvent({ type: 'motif_completion', data, receivedAt: Date.now() })
      void this.queryClient.invalidateQueries({ queryKey: ['motifs', 'completions'] })
    })
    es.addEventListener('motif_reset', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as MotifResetOut
      useLiveStreamStore.getState().pushEvent({ type: 'motif_reset', data, receivedAt: Date.now() })
      void this.queryClient.invalidateQueries({ queryKey: ['motifs', 'resets'] })
    })
    es.addEventListener('inference_result', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as EntityScoreOut
      useLiveStreamStore
        .getState()
        .pushEvent({ type: 'inference_result', data, receivedAt: Date.now() })
      void this.queryClient.invalidateQueries({ queryKey: ['scores', 'entities'] })
    })
    es.addEventListener('prune', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as AuditRecordOut
      useLiveStreamStore.getState().pushEvent({ type: 'prune', data, receivedAt: Date.now() })
      // Deliberately no `['audit', 'log']` invalidation here, unlike the
      // other three handlers above: F11.7's Log Explorer is this query
      // key's only consumer, and its acceptance criteria explicitly rule
      // out silently reordering the currently-viewed page when a new
      // record streams in -- new prune/motif-reset records should surface
      // as an explicit "N new" affordance instead (`features/logs`),
      // sourced from this store's own `events` feed, not from a refetch.
    })
    es.addEventListener('heartbeat', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { t: number }
      useLiveStreamStore.getState().recordHeartbeat(payload.t)
    })
    es.addEventListener('error', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { message: string }
      useLiveStreamStore.getState().recordError(payload.message)
    })
  }
}

export interface UseLiveStreamOptions {
  /** F13 owns turning this on/off (e.g. only while the Monitoring page is mounted). */
  enabled?: boolean
  /** Test-only seam -- jsdom has no native `EventSource`. */
  eventSourceFactory?: EventSourceFactory
}

export function useLiveStream(options: UseLiveStreamOptions = {}) {
  const { enabled = true, eventSourceFactory } = options
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled) return undefined
    const manager = new LiveStreamManager(
      `${env.apiBaseUrl}/api/stream/events`,
      queryClient,
      eventSourceFactory,
    )
    manager.start()
    return () => manager.stop()
  }, [enabled, eventSourceFactory, queryClient])

  return {
    status: useLiveStreamStore((state) => state.status),
    events: useLiveStreamStore((state) => state.events),
    lastHeartbeatAt: useLiveStreamStore((state) => state.lastHeartbeatAt),
    lastError: useLiveStreamStore((state) => state.lastError),
  }
}
