import { AutoRefreshControl } from '@/components/AutoRefreshControl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertThresholdsSection } from '@/features/settings/AlertThresholdsSection'
import { ApiConfigSection } from '@/features/settings/ApiConfigSection'
import { NotificationSection } from '@/features/settings/NotificationSection'
import { ThemeSection } from '@/features/settings/ThemeSection'

// Milestone F15 (Settings). Every preference here is client-side only
// (F15.6, `localStorage` via each store's `persist` middleware) --
// `tasks.md`'s own F15.6 line has no dependency beyond F1.4 (Zustand)
// because it isn't a seventh setting of its own, it's the persistence
// mechanism the other settings below use, until F0.11's real auth/user
// model exists to persist preferences server-side instead. F15.4 reuses
// F13.3's `AutoRefreshControl` directly rather than a second, duplicate
// control -- same "reuse and document" call F12.1/F12.2/F12.4 already
// made.
export function Component() {
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Display preference, saved in this browser.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeSection />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            Which severities trigger the notification bell and toasts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationSection />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auto-refresh</CardTitle>
          <CardDescription>
            Polling fallback for data not covered by the live event stream.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AutoRefreshControl />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API configuration</CardTitle>
          <CardDescription>Read-only -- set via build/start-time environment.</CardDescription>
        </CardHeader>
        <CardContent>
          <ApiConfigSection />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alert thresholds</CardTitle>
          <CardDescription>
            Read-only view of the protocol decay and motif configuration driving detection.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertThresholdsSection />
        </CardContent>
      </Card>
    </section>
  )
}
