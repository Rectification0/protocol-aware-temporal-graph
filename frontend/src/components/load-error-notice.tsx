import { CircleAlert } from 'lucide-react'
import { getErrorMessage } from '@/api/client'
import { cn } from '@/lib/utils'

// F16.9 follow-up: names the data sources a page *failed* to load, so a
// failed fetch is never presented as "no results". Pages that merge several
// sources (Detections: motif completions + anomaly scores + dispositions)
// keep rendering what did load; this says what's missing and why. Uses the
// infra `status-error` token, not the threat-severity palette (F5.14) --
// "the API is down" isn't a threat severity.

export interface LoadFailure {
  /** What failed to load, in the page's own words, e.g. "Anomaly scores". */
  label: string
  error: unknown
}

export function LoadErrorNotice({
  failures,
  partial,
  className,
}: {
  failures: (LoadFailure | null | false | undefined)[]
  /** Shown after the failures when other data on the page did load. */
  partial?: string
  className?: string
}) {
  const present = failures.filter((f): f is LoadFailure => Boolean(f))
  if (present.length === 0) return null

  return (
    <div
      role="alert"
      className={cn(
        'flex gap-2 rounded-md border border-status-error/40 px-3 py-2 text-sm',
        className,
      )}
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-status-error" aria-hidden="true" />
      <div className="space-y-0.5">
        {present.map((failure) => (
          <p key={failure.label}>
            <span className="font-medium text-status-error">{failure.label} unavailable:</span>{' '}
            <span className="text-muted-foreground">{getErrorMessage(failure.error)}</span>
          </p>
        ))}
        {partial && <p className="text-muted-foreground">{partial}</p>}
      </div>
    </div>
  )
}
