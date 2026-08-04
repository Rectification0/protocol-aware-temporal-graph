import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

// F5.10: severity-colored alert banner (used by F13's critical alerts).
// Reuses the same --severity-*/--status-* tokens as F5.14's badges, but as
// a banner (icon + title + description), not a compact chip.

export type AlertBannerSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

const SEVERITY_CONFIG: Record<
  AlertBannerSeverity,
  { icon: typeof AlertTriangle; borderClassName: string; iconClassName: string }
> = {
  critical: {
    icon: OctagonAlert,
    borderClassName: 'border-severity-critical/40 bg-severity-critical/10',
    iconClassName: 'text-severity-critical',
  },
  high: {
    icon: AlertTriangle,
    borderClassName: 'border-severity-high/40 bg-severity-high/10',
    iconClassName: 'text-severity-high',
  },
  medium: {
    icon: AlertTriangle,
    borderClassName: 'border-severity-medium/40 bg-severity-medium/10',
    iconClassName: 'text-severity-medium',
  },
  low: {
    icon: Info,
    borderClassName: 'border-severity-low/40 bg-severity-low/10',
    iconClassName: 'text-severity-low',
  },
  info: {
    icon: CheckCircle2,
    borderClassName: 'border-severity-info/40 bg-severity-info/10',
    iconClassName: 'text-severity-info',
  },
}

export interface AlertBannerProps {
  severity: AlertBannerSeverity
  title: string
  description?: string
  onDismiss?: () => void
  className?: string
}

export function AlertBanner({
  severity,
  title,
  description,
  onDismiss,
  className,
}: AlertBannerProps) {
  const { icon: Icon, borderClassName, iconClassName } = SEVERITY_CONFIG[severity]

  return (
    <Alert className={cn(borderClassName, className)}>
      <Icon className={cn('size-4', iconClassName)} />
      <AlertTitle className="pr-6">{title}</AlertTitle>
      {description && <AlertDescription>{description}</AlertDescription>}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss alert"
          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </Alert>
  )
}
