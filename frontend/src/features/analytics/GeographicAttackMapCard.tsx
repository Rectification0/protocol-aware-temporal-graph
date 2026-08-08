import { BackendPendingState } from '@/components/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// F12.5: `[BACKEND TODO]` -- blocked on F0.14 (no geographic/IP data
// exists anywhere in the edge schema; F0.14 is itself blocked on F0.13).
// Per this task's own instruction, stubbed with an explicit "no location
// data available" state (F5.13) rather than a placeholder map with fake
// pins -- same `BackendPendingState` pattern F10.7-F10.9 already use for
// their own `[BACKEND TODO]` panels.
export function GeographicAttackMapCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Geographic Attack Map
        </CardTitle>
      </CardHeader>
      <CardContent>
        <BackendPendingState
          taskRef="F0.14"
          description="No geographic/IP data exists anywhere in the edge schema yet -- F0.14 is itself blocked on F0.13 (tasks.md F12.5)."
        />
      </CardContent>
    </Card>
  )
}
