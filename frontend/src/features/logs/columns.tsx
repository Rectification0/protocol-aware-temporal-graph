import type { ColumnDef } from '@tanstack/react-table'
import { Link } from 'react-router-dom'
import { RelativeTimestamp } from '@/components/relative-timestamp'
import { SeverityBadge } from '@/components/severity-badge'
import { Button } from '@/components/ui/button'
import { investigationPath } from '@/config/routes'
import type { LogRow } from '@/features/logs/logic'

// F11.1/F11.4/F11.7: type, timestamp, summary, entity (linked to F10's
// Investigation page, same drill-down convention F9's `columns.tsx`
// already established for a detection's source entity), severity (the
// F11.4 "highlight malicious events" styling, via F5.14's shared
// `SeverityBadge`), and a "view raw" action (F11.3). `onViewRaw` is
// injected by `LogsPage.tsx` rather than this column set owning dialog
// state itself, matching F9's `DispositionCell` precedent of composing a
// stateful cell but not the page's overall dialog/open-state.
export function createLogColumns(onViewRaw: (row: LogRow) => void): ColumnDef<LogRow, unknown>[] {
  return [
    {
      id: 'new',
      header: '',
      cell: ({ row }) =>
        row.original.isNew ? (
          <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            New
          </span>
        ) : null,
      enableSorting: false,
    },
    {
      accessorKey: 'severity',
      header: 'Severity',
      cell: ({ row }) => <SeverityBadge severity={row.original.severity} />,
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {row.original.type === 'prune' ? 'Prune' : 'Motif reset'}
        </span>
      ),
    },
    {
      accessorKey: 'timestamp',
      header: 'Timestamp',
      cell: ({ row }) => <RelativeTimestamp seconds={row.original.timestamp} />,
    },
    {
      accessorKey: 'summary',
      header: 'Summary',
      cell: ({ row }) => <span className="text-sm">{row.original.summary}</span>,
    },
    {
      accessorKey: 'entity',
      header: 'Entity',
      cell: ({ row }) => {
        const { entity } = row.original
        if (!entity) return <span className="text-xs text-muted-foreground">--</span>
        return (
          <Link
            to={investigationPath(entity)}
            className="font-mono text-xs text-primary underline-offset-2 hover:underline"
          >
            {entity}
          </Link>
        )
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button type="button" variant="ghost" size="sm" onClick={() => onViewRaw(row.original)}>
          View raw
        </Button>
      ),
      enableSorting: false,
    },
  ]
}
