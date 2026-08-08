import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// F13.3: client-side polling control for the endpoints F0.10's stream
// doesn't cover (no `metrics_snapshot`/`health` SSE event type exists in
// `stream.py`) -- `useMetricsSnapshot`/`useHealth` (F4.2) read this
// instead of a hardcoded `refetchInterval`, so the Live Monitoring page's
// control (`AutoRefreshControl`) affects both wherever they're mounted,
// not just while that page itself is open.
//
// F15.4/F15.6: this store's own setting is what the Settings page exposes
// (reusing `AutoRefreshControl` there rather than a second, duplicate
// control) -- persisted to localStorage (`persist`, added in F15.6) so it
// now survives a reload, the same as `themeStore`/`notificationSettingsStore`.

export const AUTO_REFRESH_INTERVAL_OPTIONS_MS = [5_000, 10_000, 30_000, 60_000] as const

interface AutoRefreshStore {
  enabled: boolean
  intervalMs: number
  setEnabled: (enabled: boolean) => void
  setIntervalMs: (intervalMs: number) => void
}

export const useAutoRefreshStore = create<AutoRefreshStore>()(
  persist(
    (set) => ({
      enabled: true,
      intervalMs: AUTO_REFRESH_INTERVAL_OPTIONS_MS[0],
      setEnabled: (enabled) => set({ enabled }),
      setIntervalMs: (intervalMs) => set({ intervalMs }),
    }),
    { name: 't-gnn-auto-refresh' },
  ),
)
