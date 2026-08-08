import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ALERT_SEVERITIES } from '@/features/monitoring/logic'
import type { ThreatSeverity } from '@/components/severity-badge'

// F15.2: which severities trigger F13.4's notification panel/unread badge
// and `useLiveNotifications`'s toasts -- everything is enabled by default,
// matching pre-F15 behavior exactly (no analyst opts in to anything; they
// can only narrow it). F13.5's Critical Alerts panel is deliberately not
// affected -- that one's own definition (`filterCriticalEvents`) is a
// fixed "critical only" subset, not this configurable one (see tasks.md
// F15.2's own wording, which names F13.4, not F13.5). Persisted (F15.6)
// the same way `themeStore`/`autoRefreshStore` are.

interface NotificationSettingsStore {
  enabledSeverities: ThreatSeverity[]
  setSeverityEnabled: (severity: ThreatSeverity, enabled: boolean) => void
}

export const useNotificationSettingsStore = create<NotificationSettingsStore>()(
  persist(
    (set, get) => ({
      enabledSeverities: [...ALERT_SEVERITIES],
      setSeverityEnabled: (severity, enabled) => {
        const current = get().enabledSeverities
        const next = enabled
          ? current.includes(severity)
            ? current
            : [...current, severity]
          : current.filter((s) => s !== severity)
        set({ enabledSeverities: next })
      },
    }),
    { name: 't-gnn-notification-settings' },
  ),
)
