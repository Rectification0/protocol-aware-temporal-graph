import type { ColumnDef } from '@tanstack/react-table'
import { Link } from 'react-router-dom'
import { RelativeTimestamp } from '@/components/relative-timestamp'
import { investigationPath } from '@/config/routes'
import type { MotifCompletionOut, PrunedEdgeOut } from '@/types/api'

// F10.4/F10.6: one row per pruned edge touching this entity (as either
// endpoint) -- this doubles as "log history" per tasks.md's F10.6
// instruction not to build a second, differently-shaped panel implying a
// separate raw-log data source that doesn't exist.
export function timelineColumns(entityId: string): ColumnDef<PrunedEdgeOut, unknown>[] {
  return [
    {
      accessorKey: 't_e',
      header: 'Time',
      cell: ({ row }) => <RelativeTimestamp seconds={row.original.t_e} />,
    },
    {
      id: 'activity',
      header: 'Activity',
      cell: ({ row }) => {
        const { src, dst } = row.original
        const other = src === entityId ? dst : src
        const direction = src === entityId ? 'to' : 'from'
        return (
          <span className="font-mono text-xs">
            {direction}{' '}
            <Link
              to={investigationPath(other)}
              className="text-primary underline-offset-2 hover:underline"
            >
              {other}
            </Link>
          </span>
        )
      },
    },
    { accessorKey: 'edge_type', header: 'Type' },
    { accessorKey: 'protocol', header: 'Protocol' },
    {
      accessorKey: 'w_at_prune',
      header: 'Weight at prune',
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">{row.original.w_at_prune.toFixed(3)}</span>
      ),
    },
  ]
}

// F10.5: motif completions where this entity is the `chain_key` --
// "every rule this entity has ever triggered," not a sample.
export const triggeredRuleColumns: ColumnDef<MotifCompletionOut, unknown>[] = [
  {
    accessorKey: 'completed_at',
    header: 'Time',
    cell: ({ row }) => <RelativeTimestamp seconds={row.original.completed_at} />,
  },
  { accessorKey: 'motif_name', header: 'Motif' },
  {
    accessorKey: 'confidence',
    header: 'Confidence',
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">{row.original.confidence.toFixed(2)}</span>
    ),
  },
  {
    id: 'matched_edges',
    header: 'Matched edges',
    cell: ({ row }) => row.original.matched_edges.length,
  },
]
