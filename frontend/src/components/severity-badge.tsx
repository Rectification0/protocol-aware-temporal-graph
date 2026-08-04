import { cn } from '@/lib/utils'

// F5.14: severity/status badges shared across F9 (Detection Matrix), F10
// (Investigation), F11 (Log Explorer). Tonal style (translucent tint +
// solid-colored text/dot), not a solid fill -- the --severity-*/--status-*
// tokens (src/index.css) were verified as *text* contrast against the
// dark background/card, not as white-on-color button fills, so tonal is
// the correct application of them, not just a stylistic choice.

type Tone = {
  label: string
  dotClassName: string
  textClassName: string
  bgClassName: string
}

function ToneBadge({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium',
        tone.bgClassName,
        tone.textClassName,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', tone.dotClassName)} aria-hidden="true" />
      {tone.label}
    </span>
  )
}

// --- Threat severity (F9's detection rows) -----------------------------

export type ThreatSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

const SEVERITY_TONES: Record<ThreatSeverity, Tone> = {
  critical: {
    label: 'Critical',
    dotClassName: 'bg-severity-critical',
    textClassName: 'text-severity-critical',
    bgClassName: 'bg-severity-critical/15',
  },
  high: {
    label: 'High',
    dotClassName: 'bg-severity-high',
    textClassName: 'text-severity-high',
    bgClassName: 'bg-severity-high/15',
  },
  medium: {
    label: 'Medium',
    dotClassName: 'bg-severity-medium',
    textClassName: 'text-severity-medium',
    bgClassName: 'bg-severity-medium/15',
  },
  low: {
    label: 'Low',
    dotClassName: 'bg-severity-low',
    textClassName: 'text-severity-low',
    bgClassName: 'bg-severity-low/15',
  },
  info: {
    label: 'Info',
    dotClassName: 'bg-severity-info',
    textClassName: 'text-severity-info',
    bgClassName: 'bg-severity-info/15',
  },
}

export function SeverityBadge({
  severity,
  className,
}: {
  severity: ThreatSeverity
  className?: string
}) {
  return <ToneBadge tone={SEVERITY_TONES[severity]} className={className} />
}

// --- False-positive / true-positive disposition (F9.5) -----------------
//
// Matches `src/t_gnn/api/schemas.py`'s `MotifFeedbackIn.disposition`
// literal exactly (`"true_positive" | "false_positive"`) plus a
// client-only `"unconfirmed"` for completions with no analyst feedback
// row yet -- not a third backend value.

export type FeedbackDisposition = 'true_positive' | 'false_positive' | 'unconfirmed'

const DISPOSITION_TONES: Record<FeedbackDisposition, Tone> = {
  true_positive: {
    label: 'True positive',
    dotClassName: 'bg-severity-critical',
    textClassName: 'text-severity-critical',
    bgClassName: 'bg-severity-critical/15',
  },
  false_positive: {
    label: 'False positive',
    dotClassName: 'bg-status-success',
    textClassName: 'text-status-success',
    bgClassName: 'bg-status-success/15',
  },
  unconfirmed: {
    label: 'Unconfirmed',
    dotClassName: 'bg-severity-info',
    textClassName: 'text-severity-info',
    bgClassName: 'bg-severity-info/15',
  },
}

export function DispositionBadge({
  disposition,
  className,
}: {
  disposition: FeedbackDisposition
  className?: string
}) {
  return <ToneBadge tone={DISPOSITION_TONES[disposition]} className={className} />
}

// --- Investigation status (F9.1/F10 column) -----------------------------
//
// Presentational only: no backend field for "investigation status" exists
// anywhere yet (unlike disposition above, which is real via motif_feedback
// -- see tasks.md F9.1's note). This is a generic, industry-standard
// status vocabulary so the component is ready whenever F9.1/F10 defines
// where this data actually comes from; it does not imply that data exists
// today.

export type InvestigationStatus = 'new' | 'investigating' | 'resolved' | 'closed'

const INVESTIGATION_STATUS_TONES: Record<InvestigationStatus, Tone> = {
  new: {
    label: 'New',
    dotClassName: 'bg-severity-high',
    textClassName: 'text-severity-high',
    bgClassName: 'bg-severity-high/15',
  },
  investigating: {
    label: 'Investigating',
    dotClassName: 'bg-primary',
    textClassName: 'text-primary',
    bgClassName: 'bg-primary/15',
  },
  resolved: {
    label: 'Resolved',
    dotClassName: 'bg-status-success',
    textClassName: 'text-status-success',
    bgClassName: 'bg-status-success/15',
  },
  closed: {
    label: 'Closed',
    dotClassName: 'bg-muted-foreground',
    textClassName: 'text-muted-foreground',
    bgClassName: 'bg-muted-foreground/15',
  },
}

export function InvestigationStatusBadge({
  status,
  className,
}: {
  status: InvestigationStatus
  className?: string
}) {
  return <ToneBadge tone={INVESTIGATION_STATUS_TONES[status]} className={className} />
}
