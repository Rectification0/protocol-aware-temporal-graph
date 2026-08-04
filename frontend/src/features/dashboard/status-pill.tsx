import { cn } from '@/lib/utils'

// A small tone badge for infra/monitoring status (F6.2-F6.5) -- distinct
// from F5.14's `SeverityBadge`/`InvestigationStatusBadge`/`DispositionBadge`,
// which are specifically the *threat-detection* vocabulary (F9/F10/F11).
// "System health" and "monitoring liveness" aren't threat severities, so
// this reuses the same tonal dot+text visual pattern without stretching
// F5.14's vocabulary to cover a different meaning.

export type StatusTone = 'success' | 'warning' | 'error' | 'neutral'

const TONE_CLASSNAME: Record<StatusTone, string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
  neutral: 'text-muted-foreground',
}

const DOT_CLASSNAME: Record<StatusTone, string> = {
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
  neutral: 'bg-muted-foreground',
}

export function StatusPill({
  tone,
  label,
  className,
}: {
  tone: StatusTone
  label: string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm font-medium',
        TONE_CLASSNAME[tone],
        className,
      )}
    >
      <span className={cn('size-2 rounded-full', DOT_CLASSNAME[tone])} aria-hidden="true" />
      {label}
    </span>
  )
}

/** A compact "Postgres •" / "Neo4j •" style indicator for F6.4's dependency breakdown. */
export function DependencyDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span
        className={cn('size-1.5 rounded-full', ok ? 'bg-status-success' : 'bg-status-error')}
        aria-hidden="true"
      />
      {label}
    </span>
  )
}
