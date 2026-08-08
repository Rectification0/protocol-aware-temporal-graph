import { create } from 'zustand'

// F13.3: client-side polling control for the endpoints F0.10's stream
// doesn't cover (no `metrics_snapshot`/`health` SSE event type exists in
// `stream.py`) -- `useMetricsSnapshot`/`useHealth` (F4.2) read this
// instead of a hardcoded `refetchInterval`, so the Live Monitoring page's
// control (`AutoRefreshControl`) affects both wherever they're mounted,
// not just while that page itself is open.

export const AUTO_REFRESH_INTERVAL_OPTIONS_MS = [5_000, 10_000, 30_000, 60_000] as const

interface AutoRefreshStore {
  enabled: boolean
  intervalMs: number
  setEnabled: (enabled: boolean) => void
  setIntervalMs: (intervalMs: number) => void
}

export const useAutoRefreshStore = create<AutoRefreshStore>((set) => ({
  enabled: true,
  intervalMs: AUTO_REFRESH_INTERVAL_OPTIONS_MS[0],
  setEnabled: (enabled) => set({ enabled }),
  setIntervalMs: (intervalMs) => set({ intervalMs }),
}))
