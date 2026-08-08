import { AutoRefreshControl } from '@/components/AutoRefreshControl'
import { CriticalAlertsPanel } from '@/features/monitoring/CriticalAlertsPanel'
import { LiveEventFeed } from '@/features/monitoring/LiveEventFeed'

// Milestone F13 (Live Monitoring). F13.1's actual wiring (the single
// global SSE connection F6/F7/F9's live tiles now benefit from) lives in
// `AppShell.tsx`, not this page -- there's nothing page-specific about
// "is the connection open," so it's mounted once for the whole
// authenticated app rather than only while this page is visible.
// F13.4's `NotificationsPanel` similarly lives in the Navbar, not here,
// since a bell icon needs to be reachable from every page, not just this
// one. What's actually page-specific: F13.3's polling control, F13.5's
// critical-alerts subset, and F13.2's full raw feed (with F13.6's Ack
// action inline on each detection row).
export function Component() {
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Live Monitoring</h1>

      <div className="rounded-md border p-4">
        <AutoRefreshControl />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Critical Alerts</h2>
        <CriticalAlertsPanel />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Live Event Stream</h2>
        <LiveEventFeed />
      </div>
    </section>
  )
}
