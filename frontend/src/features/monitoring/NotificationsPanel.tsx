import { formatDistanceToNowStrict } from 'date-fns'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AckButton } from '@/features/monitoring/AckButton'
import {
  countUnreadAlerts,
  detectionRefFor,
  filterAlertEvents,
  summarizeLiveEvent,
} from '@/features/monitoring/logic'
import { useLiveStreamStore } from '@/store/liveStreamStore'
import { useNotificationsStore } from '@/store/notificationsStore'

const MAX_RECENT_ALERTS = 10

// F13.4: bell icon + unread badge in the Navbar, backed by F13.2's raw
// event feed filtered to alert-worthy events (`features/monitoring/logic.ts`'s
// `filterAlertEvents`) -- the same "only a real detection counts"
// definition F13.5's Critical Alerts panel and `useLiveNotifications`'s
// toasts both already use. Rows are plain `div`s, not `DropdownMenuItem`s
// -- Radix closes the menu on any item selection by default, which would
// dismiss the whole panel the instant an analyst clicked F13.6's `AckButton`
// inside one. Opening the dropdown marks every currently-seen alert read
// (`markAllRead()`); "unread" is *when* an alert arrived relative to that,
// not a persisted per-alert flag.
export function NotificationsPanel() {
  const events = useLiveStreamStore((state) => state.events)
  const lastReadAt = useNotificationsStore((state) => state.lastReadAt)
  const markAllRead = useNotificationsStore((state) => state.markAllRead)

  const alerts = filterAlertEvents(events).slice(0, MAX_RECENT_ALERTS)
  const unreadCount = countUnreadAlerts(events, lastReadAt)

  return (
    <DropdownMenu onOpenChange={(open) => open && markAllRead()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-severity-critical text-[10px] font-semibold text-white"
              aria-label={`${unreadCount} unread alerts`}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Recent alerts</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {alerts.length === 0 ? (
          <p className="px-2 py-3 text-center text-sm text-muted-foreground">No alerts yet.</p>
        ) : (
          alerts.map((event, index) => {
            const detection = detectionRefFor(event)
            return (
              <div
                key={`${event.receivedAt}-${index}`}
                className="space-y-1 border-b border-border px-2 py-2 last:border-b-0"
              >
                <p className="text-sm">{summarizeLiveEvent(event)}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNowStrict(new Date(event.receivedAt), { addSuffix: true })}
                  </span>
                  {detection && (
                    <AckButton
                      detectionType={detection.detectionType}
                      detectionRef={detection.detectionRef}
                    />
                  )}
                </div>
              </div>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
