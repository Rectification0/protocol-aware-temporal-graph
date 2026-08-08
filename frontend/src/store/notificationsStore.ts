import { create } from 'zustand'

// F13.4: tracks when the notification bell was last opened, so
// `features/monitoring/logic.ts`'s `countUnreadAlerts()` knows which
// `useLiveStreamStore` events are "unread" -- deliberately a separate
// store from `liveStreamStore` (whose own job is raw event transport
// state, not derived UI read-state), the same single-responsibility split
// `authStore`/`timeRangeStore` already keep from each other.

interface NotificationsStore {
  lastReadAt: number
  markAllRead: () => void
}

export const useNotificationsStore = create<NotificationsStore>((set) => ({
  lastReadAt: 0,
  markAllRead: () => set({ lastReadAt: Date.now() }),
}))
