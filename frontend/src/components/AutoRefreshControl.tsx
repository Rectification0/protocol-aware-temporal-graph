import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AUTO_REFRESH_INTERVAL_OPTIONS_MS, useAutoRefreshStore } from '@/store/autoRefreshStore'

function formatIntervalLabel(ms: number): string {
  return `${ms / 1000}s`
}

// F13.3: toggle + interval control for the polling fallback that backs
// endpoints F0.10's stream doesn't cover (F0.2's metrics snapshot,
// F0.9's health check) -- see `useMetricsSnapshot`/`useHealth`'s own
// comments for why those two specifically still need one. A single
// shared control (not one per endpoint), per this task's own line.
export function AutoRefreshControl({ className }: { className?: string }) {
  const enabled = useAutoRefreshStore((state) => state.enabled)
  const intervalMs = useAutoRefreshStore((state) => state.intervalMs)
  const setEnabled = useAutoRefreshStore((state) => state.setEnabled)
  const setIntervalMs = useAutoRefreshStore((state) => state.setIntervalMs)

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <Checkbox
          id="auto-refresh-enabled"
          checked={enabled}
          onCheckedChange={(checked) => setEnabled(checked === true)}
        />
        <Label htmlFor="auto-refresh-enabled">Auto-refresh non-live data</Label>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Label htmlFor="auto-refresh-interval" className="text-muted-foreground">
          Interval
        </Label>
        <Select
          value={String(intervalMs)}
          onValueChange={(value) => setIntervalMs(Number(value))}
          disabled={!enabled}
        >
          <SelectTrigger id="auto-refresh-interval" className="h-8 w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUTO_REFRESH_INTERVAL_OPTIONS_MS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {formatIntervalLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
