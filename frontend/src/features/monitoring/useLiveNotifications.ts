import { useEffect, useRef } from 'react'
import { toast } from '@/components/toast'
import { filterEnabledAlertEvents, summarizeLiveEvent } from '@/features/monitoring/logic'
import { useLiveStreamStore } from '@/store/liveStreamStore'
import { useNotificationSettingsStore } from '@/store/notificationSettingsStore'

export interface UseLiveNotificationsOptions {
  enabled?: boolean
}

// F13.4: toasts (F5.11) for newly-arrived alert-worthy live events --
// mounted once in `AppShell` alongside F13.1's single stream connection,
// so a toast fires regardless of which page the analyst is currently on,
// not just while a specific tile happens to be mounted.
//
// `lastNotifiedAtRef` is set to "now" the first time this effect runs
// (inside the effect, not during render -- an impure `Date.now()` read in
// a component body is exactly what F6.7/F6.3's own comments already flag
// as unsafe under the React Compiler's purity lint), rather than starting
// at 0: `useLiveStreamStore`'s events persist across page navigations
// within a session, so treating every already-buffered event as "new" on
// this hook's first mount would fire a burst of stale toasts.
export function useLiveNotifications(options: UseLiveNotificationsOptions = {}) {
  const { enabled = true } = options
  const events = useLiveStreamStore((state) => state.events)
  const enabledSeverities = useNotificationSettingsStore((state) => state.enabledSeverities)
  const lastNotifiedAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return

    if (lastNotifiedAtRef.current === null) {
      lastNotifiedAtRef.current = Date.now()
      return
    }

    const cutoff = lastNotifiedAtRef.current
    const fresh = filterEnabledAlertEvents(events, enabledSeverities).filter(
      (event) => event.receivedAt > cutoff,
    )
    if (fresh.length === 0) return

    lastNotifiedAtRef.current = fresh[0].receivedAt
    // `events`/`fresh` are newest-first -- reverse so a burst of several
    // new alerts toasts in the order they actually happened.
    for (const event of fresh.slice().reverse()) {
      toast(summarizeLiveEvent(event))
    }
  }, [events, enabled, enabledSeverities])
}
