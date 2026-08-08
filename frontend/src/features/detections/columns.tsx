import type { ColumnDef } from '@tanstack/react-table'
import { formatDistanceToNowStrict } from 'date-fns'
import { Button } from '@/components/ui/button'
import {
  DispositionBadge,
  InvestigationStatusBadge,
  SeverityBadge,
  type FeedbackDisposition,
} from '@/components/severity-badge'
import type { DetectionRow } from '@/features/detections/logic'
import { useSubmitMotifFeedback } from '@/hooks/api'
import { useAuthStore } from '@/store/authStore'

// F9.5: the false-positive/true-positive marker, writable only for
// motif-path rows -- the anomaly (T-GNN deviation) path has no
// `motif_feedback`-shaped backend concept to attribute a disposition to
// at all (`logic.ts`'s `buildAnomalyDetectionRows` doc comment), so those
// rows render the badge alone with an explanatory tooltip instead of
// silently offering buttons that would 404/error.
function DispositionCell({ row }: { row: DetectionRow }) {
  const submitFeedback = useSubmitMotifFeedback()
  const analyst = useAuthStore((state) => state.session?.analyst ?? null)

  if (row.path !== 'motif' || !row.motifName || !row.chainKey) {
    return (
      <div className="flex items-center gap-2">
        <DispositionBadge disposition={row.disposition} />
        <span
          className="text-xs text-muted-foreground"
          title="The T-GNN deviation path has no analyst-feedback mechanism in the backend yet (tasks.md F9.5)."
        >
          n/a
        </span>
      </div>
    )
  }

  function mark(disposition: FeedbackDisposition) {
    if (disposition === 'unconfirmed' || !row.motifName || !row.chainKey) return
    submitFeedback.mutate({
      motif_name: row.motifName,
      chain_key: row.chainKey,
      disposition,
      analyst,
    })
  }

  return (
    <div className="flex items-center gap-2">
      <DispositionBadge disposition={row.disposition} />
      <div className="flex gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
          disabled={submitFeedback.isPending}
          onClick={() => mark('true_positive')}
        >
          TP
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
          disabled={submitFeedback.isPending}
          onClick={() => mark('false_positive')}
        >
          FP
        </Button>
      </div>
    </div>
  )
}

function TimestampCell({ timestamp }: { timestamp: number }) {
  const date = new Date(timestamp * 1000)
  return (
    <span title={date.toLocaleString()}>
      {formatDistanceToNowStrict(date, { addSuffix: true })}
    </span>
  )
}

// F9.1: severity, confidence score, detection category, detection model,
// timestamp, source, status (F9.5's disposition), investigation status.
export const detectionColumns: ColumnDef<DetectionRow, unknown>[] = [
  {
    accessorKey: 'severity',
    header: 'Severity',
    cell: ({ row }) => <SeverityBadge severity={row.original.severity} />,
  },
  {
    accessorKey: 'confidence',
    header: 'Confidence',
    cell: ({ row }) => {
      const { confidence } = row.original
      return (
        <span className="font-mono tabular-nums">
          {confidence === null ? (
            <span title="The T-GNN deviation path has no confidence concept -- see the Severity column instead.">
              --
            </span>
          ) : (
            confidence.toFixed(2)
          )}
        </span>
      )
    },
  },
  {
    accessorKey: 'category',
    header: 'Category',
  },
  {
    accessorKey: 'model',
    header: 'Detection Model',
    cell: ({ row }) => <code className="text-xs">{row.original.model}</code>,
  },
  {
    accessorKey: 'timestamp',
    header: 'Timestamp',
    cell: ({ row }) => <TimestampCell timestamp={row.original.timestamp} />,
  },
  {
    accessorKey: 'source',
    header: 'Source',
    cell: ({ row }) => <code className="text-xs">{row.original.source}</code>,
  },
  {
    id: 'status',
    header: 'Status',
    accessorFn: (row) => row.disposition,
    cell: ({ row }) => <DispositionCell row={row.original} />,
  },
  {
    accessorKey: 'investigationStatus',
    header: 'Investigation',
    cell: ({ row }) => <InvestigationStatusBadge status={row.original.investigationStatus} />,
  },
]
