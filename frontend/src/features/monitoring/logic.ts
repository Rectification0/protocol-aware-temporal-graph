import { severityFromAnomalyScore, severityFromMotifConfidence } from '@/features/detections/logic'
import type { ThreatSeverity } from '@/components/severity-badge'
import type { StatusTone } from '@/features/dashboard/status-pill'
import type { LiveStreamEvent, LiveStreamStatus } from '@/store/liveStreamStore'

// Milestone F13 (Live Monitoring). Pure/testable derivations live here,
// same split every earlier milestone's `logic.ts` established --
// `LiveEventFeed`/`CriticalAlertsPanel`/`NotificationsPanel` just wire
// `useLiveStreamStore`'s event feed through these.

// --- event classification --------------------------------------------
//
// Only the two real detection paths (F9's own split) count as an "alert"
// worth a toast/notification-badge/critical-alert-banner -- `motif_reset`
// (a partial chain discarded, F11's own domain) and `prune` (routine
// decay-driven eviction) are operational/audit events, not detections,
// so they never appear here even though they're still real rows in
// F13.2's raw feed. An `inference_result` only counts when its score
// clears the same "not benign" bar F7.1/F9.3 already use -- reusing
// `features/detections/logic.ts`'s severity functions (not a fourth,
// disagreeing severity scheme) for both the alert-worthiness check and
// the severity shown alongside it.

export function eventSeverity(event: LiveStreamEvent): ThreatSeverity | null {
  if (event.type === 'motif_completion') {
    return severityFromMotifConfidence(event.data.confidence)
  }
  if (event.type === 'inference_result') {
    const severity = severityFromAnomalyScore(event.data.score)
    return severity === 'info' ? null : severity
  }
  return null
}

export function isAlertEvent(event: LiveStreamEvent): boolean {
  return eventSeverity(event) !== null
}

export function filterAlertEvents(events: LiveStreamEvent[]): LiveStreamEvent[] {
  return events.filter(isAlertEvent)
}

// --- F13.4: unread count -------------------------------------------------

export function countUnreadAlerts(events: LiveStreamEvent[], lastReadAt: number): number {
  return filterAlertEvents(events).filter((event) => event.receivedAt > lastReadAt).length
}

// --- F13.5: critical-only subset ------------------------------------------

export function filterCriticalEvents(events: LiveStreamEvent[]): LiveStreamEvent[] {
  return events.filter((event) => eventSeverity(event) === 'critical')
}

// --- display ---------------------------------------------------------------

const EVENT_TYPE_LABEL: Record<LiveStreamEvent['type'], string> = {
  motif_completion: 'Motif completion',
  motif_reset: 'Motif reset',
  inference_result: 'Score update',
  prune: 'Prune',
}

export function eventTypeLabel(type: LiveStreamEvent['type']): string {
  return EVENT_TYPE_LABEL[type]
}

/** F13.2's raw-feed summary line, shared with F13.4's notification list
 * and `useLiveNotifications`' toast body -- one description, everywhere
 * this event is shown as text. */
export function summarizeLiveEvent(event: LiveStreamEvent): string {
  switch (event.type) {
    case 'motif_completion':
      return `${event.data.motif_name} completed (chain ${event.data.chain_key})`
    case 'motif_reset':
      return `${event.data.motif_name} reset (chain ${event.data.chain_key})`
    case 'inference_result':
      return `${event.data.entity_id} scored ${event.data.score.toFixed(2)}`
    case 'prune':
      return `Pruned ${event.data.edge_type ?? 'edge'}: ${event.data.src ?? '?'} -> ${event.data.dst ?? '?'}`
  }
}

// --- F13.6: detection-ref construction --------------------------------
//
// Matches `src/t_gnn/api/routers/alerts.py`'s own documented `detection_ref`
// shapes exactly (`{motif_name}:{chain_key}:{completed_at}` /
// `{entity_id}:{t}`) -- only `motif_completion`/`inference_result` events
// have a detection to acknowledge at all; `motif_reset`/`prune` return
// `null` rather than a fabricated ref.

export interface DetectionRefTarget {
  detectionType: string
  detectionRef: string
}

export function detectionRefFor(event: LiveStreamEvent): DetectionRefTarget | null {
  if (event.type === 'motif_completion') {
    return {
      detectionType: 'motif_completion',
      detectionRef: `${event.data.motif_name}:${event.data.chain_key}:${event.data.completed_at}`,
    }
  }
  if (event.type === 'inference_result') {
    return { detectionType: 'anomaly', detectionRef: `${event.data.entity_id}:${event.data.t}` }
  }
  return null
}

export function ackKey(detectionType: string, detectionRef: string): string {
  return `${detectionType}:${detectionRef}`
}

// --- F13.2: connection-status display -------------------------------------
//
// Reuses F6.2-F6.5's `StatusPill` tone vocabulary (cross-feature reuse,
// same precedent F7's `UserThreatCountsPanel` already set) -- "is the
// live stream connected" is infra/monitoring status, not a threat
// severity, so this doesn't stretch F5.14's `SeverityBadge` vocabulary.

const CONNECTION_STATUS_TONE: Record<LiveStreamStatus, StatusTone> = {
  open: 'success',
  connecting: 'warning',
  reconnecting: 'warning',
  closed: 'neutral',
  idle: 'neutral',
}

export function connectionStatusTone(status: LiveStreamStatus): StatusTone {
  return CONNECTION_STATUS_TONE[status]
}
