import { formatDistanceStrict, formatDistanceToNowStrict } from 'date-fns'
import { memo } from 'react'
import { SeverityBadge } from '@/components/severity-badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { StatusPill } from '@/features/dashboard/status-pill'
import { AckButton } from '@/features/monitoring/AckButton'
import {
  connectionStatusTone,
  detectionRefFor,
  eventSeverity,
  eventTypeLabel,
  summarizeLiveEvent,
} from '@/features/monitoring/logic'
import { useNow } from '@/hooks/useNow'
import { liveEventKey, type LiveStreamEvent, useLiveStreamStore } from '@/store/liveStreamStore'

const CONNECTION_STATUS_LABEL: Record<string, string> = {
  open: 'Live',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  closed: 'Disconnected',
  idle: 'Idle',
}

// F13.2: raw feed of every event `useLiveStreamStore` has seen (bounded
// to the store's own 200-event cap) -- tasks.md's own line names
// `MotifCompletionEvent`/`PrunedEdgeEvent`/`InferenceResult`, but
// `motif_reset` is included too for completeness, since the store (and
// F0.10's stream) already carries it as a fourth real event type and
// omitting it from this specific panel would just be an odd, undocumented
// gap. F13.6's `AckButton` renders only for the two rows that are
// actually detections (`detectionRefFor()` returns `null` for
// `motif_reset`/`prune`).
// F16.6: memoized per event (events are immutable, so object identity is a
// sufficient prop comparison) -- a new event renders one new row instead
// of re-rendering all 200. `useNow()` keeps the relative time ticking.
const LiveEventRow = memo(function LiveEventRow({ event }: { event: LiveStreamEvent }) {
  const now = useNow()
  const severity = eventSeverity(event)
  const detection = detectionRefFor(event)
  return (
    <TableRow>
      <TableCell className="w-28 font-mono text-xs">{eventTypeLabel(event.type)}</TableCell>
      <TableCell className="w-20">{severity && <SeverityBadge severity={severity} />}</TableCell>
      <TableCell className="text-sm">{summarizeLiveEvent(event)}</TableCell>
      <TableCell className="w-28 text-xs text-muted-foreground">
        {formatDistanceStrict(new Date(event.receivedAt), Math.max(now, event.receivedAt), {
          addSuffix: true,
        })}
      </TableCell>
      <TableCell className="w-32">
        {detection && (
          <AckButton
            detectionType={detection.detectionType}
            detectionRef={detection.detectionRef}
          />
        )}
      </TableCell>
    </TableRow>
  )
})

export function LiveEventFeed() {
  const status = useLiveStreamStore((state) => state.status)
  const events = useLiveStreamStore((state) => state.events)
  const lastHeartbeatAt = useLiveStreamStore((state) => state.lastHeartbeatAt)
  const lastError = useLiveStreamStore((state) => state.lastError)
  const clear = useLiveStreamStore((state) => state.clear)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span role="status" aria-label={`Live stream: ${CONNECTION_STATUS_LABEL[status]}`}>
            <StatusPill
              tone={connectionStatusTone(status)}
              label={CONNECTION_STATUS_LABEL[status]}
            />
          </span>
          {lastHeartbeatAt !== null && (
            <span className="text-xs text-muted-foreground">
              Last heartbeat{' '}
              {formatDistanceToNowStrict(new Date(lastHeartbeatAt * 1000), { addSuffix: true })}
            </span>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={clear} disabled={!events.length}>
          Clear feed
        </Button>
      </div>

      {lastError && (
        <p className="text-xs text-status-error">Stream error: {lastError} -- still retrying.</p>
      )}

      <ScrollArea className="h-96 rounded-md border">
        <Table>
          <TableBody>
            {events.length === 0 ? (
              <TableRow>
                <TableCell className="h-24 text-center text-sm text-muted-foreground">
                  No live events yet.
                </TableCell>
              </TableRow>
            ) : (
              events.map((event) => <LiveEventRow key={liveEventKey(event)} event={event} />)
            )}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  )
}
