import { AlertBanner } from '@/components/alert-banner'
import { AckButton } from '@/features/monitoring/AckButton'
import {
  detectionRefFor,
  filterCriticalEvents,
  summarizeLiveEvent,
} from '@/features/monitoring/logic'
import { useLiveStreamStore } from '@/store/liveStreamStore'
import type { LiveStreamEvent } from '@/store/liveStreamStore'

const MAX_CRITICAL_ALERTS = 10

function alertTitle(event: LiveStreamEvent): string {
  return event.type === 'motif_completion' ? 'Motif completed' : 'Anomalous score'
}

// F13.5: the severity-'critical' subset of F13.2's raw feed, via F5.10's
// `AlertBanner` -- reuses F9's own severity classification
// (`features/monitoring/logic.ts`'s `eventSeverity()`), not a fourth
// severity scheme. `AlertBanner` has no built-in slot for extra actions,
// so F13.6's `AckButton` is composed as a footer row beneath each banner
// rather than changing that shared component's props.
export function CriticalAlertsPanel() {
  const events = useLiveStreamStore((state) => state.events)
  const criticalEvents = filterCriticalEvents(events).slice(0, MAX_CRITICAL_ALERTS)

  if (criticalEvents.length === 0) {
    return <p className="text-sm text-muted-foreground">No critical alerts right now.</p>
  }

  return (
    <div className="space-y-2">
      {criticalEvents.map((event, index) => {
        const detection = detectionRefFor(event)
        return (
          <div key={`${event.receivedAt}-${index}`} className="space-y-1">
            <AlertBanner
              severity="critical"
              title={alertTitle(event)}
              description={summarizeLiveEvent(event)}
            />
            {detection && (
              <div className="flex justify-end">
                <AckButton
                  detectionType={detection.detectionType}
                  detectionRef={detection.detectionRef}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
