import { SeverityBadge } from '@/components/severity-badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ALERT_SEVERITIES } from '@/features/monitoring/logic'
import { useNotificationSettingsStore } from '@/store/notificationSettingsStore'

// F15.2: which severities trigger F13.4's notification panel/unread badge
// and toasts. F13.5's Critical Alerts panel is a separate, fixed
// "critical only" subset (tasks.md F15.2's own wording names F13.4, not
// F13.5) and isn't affected by this control.
export function NotificationSection() {
  const enabledSeverities = useNotificationSettingsStore((state) => state.enabledSeverities)
  const setSeverityEnabled = useNotificationSettingsStore((state) => state.setSeverityEnabled)

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Only alert-worthy events (a motif completion, or a non-benign score) at an enabled severity
        reach the notification bell and toasts.
      </p>
      <div className="flex flex-wrap gap-4">
        {ALERT_SEVERITIES.map((severity) => (
          <div key={severity} className="flex items-center gap-2">
            <Checkbox
              id={`notify-severity-${severity}`}
              checked={enabledSeverities.includes(severity)}
              onCheckedChange={(checked) => setSeverityEnabled(severity, checked === true)}
            />
            <Label htmlFor={`notify-severity-${severity}`}>
              <SeverityBadge severity={severity} />
            </Label>
          </div>
        ))}
      </div>
    </div>
  )
}
