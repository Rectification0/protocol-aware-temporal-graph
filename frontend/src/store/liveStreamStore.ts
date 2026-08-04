import { create } from 'zustand'
import type { AuditRecordOut, EntityScoreOut, MotifCompletionOut, MotifResetOut } from '@/types/api'

// F4.6: the "dedicated live-event store" half of F0.10's SSE stream --
// F13.2's raw event-feed panel and F7.4's live attack counter both read
// from this rather than re-subscribing to the stream themselves.
// `useLiveStream` (`src/api/liveStream.ts`) is the only writer.

export type LiveStreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

export type LiveStreamEvent =
  | { type: 'motif_completion'; data: MotifCompletionOut; receivedAt: number }
  | { type: 'motif_reset'; data: MotifResetOut; receivedAt: number }
  | { type: 'inference_result'; data: EntityScoreOut; receivedAt: number }
  | { type: 'prune'; data: AuditRecordOut; receivedAt: number }

const MAX_EVENTS = 200

interface LiveStreamState {
  status: LiveStreamStatus
  events: LiveStreamEvent[]
  lastHeartbeatAt: number | null
  lastError: string | null
  setStatus: (status: LiveStreamStatus) => void
  pushEvent: (event: LiveStreamEvent) => void
  recordHeartbeat: (t: number) => void
  recordError: (message: string) => void
  clear: () => void
}

export const useLiveStreamStore = create<LiveStreamState>((set) => ({
  status: 'idle',
  events: [],
  lastHeartbeatAt: null,
  lastError: null,
  setStatus: (status) => set({ status }),
  pushEvent: (event) =>
    set((state) => ({
      // Newest first (F13.2 renders it as a feed); bounded so a busy
      // pipeline can't grow this without limit for the life of the tab.
      events: [event, ...state.events].slice(0, MAX_EVENTS),
    })),
  recordHeartbeat: (t) => set({ lastHeartbeatAt: t }),
  recordError: (message) => set({ lastError: message }),
  clear: () => set({ events: [], lastError: null }),
}))
