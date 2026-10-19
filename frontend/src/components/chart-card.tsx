import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

// The frame every analytics chart sits in: a header strip that *leads with
// the number* (the chart is the supporting evidence, not the point), an
// optional delta vs the previous period, a caption naming source/sample,
// a chart <-> table toggle (the WCAG-clean twin of every chart -- values
// are never reachable only by hovering), and refetch handling that dims
// the previous render instead of flashing a skeleton.

export interface ChartCardDelta {
  direction: 'up' | 'down' | 'flat'
  /** e.g. "+12% vs previous period" (see analytics/logic.ts computePeriodDelta) */
  text: string
  /** Whether "up" is good news -- more attacks is bad, more accuracy is good. */
  upIsGood: boolean
}

export interface ChartCardTable {
  columns: string[]
  rows: (string | number)[][]
}

export interface ChartCardProps {
  title: string
  /** The headline value, already formatted (e.g. "37", "92%"). */
  headline?: ReactNode
  /** Small text after the headline, e.g. "attacks". */
  headlineUnit?: string
  /** Exactly one card per page is the hero -- a larger headline. */
  hero?: boolean
  delta?: ChartCardDelta
  caption?: ReactNode
  table?: ChartCardTable
  /** A background refetch is in flight while showing the last result. */
  refreshing?: boolean
  className?: string
  children: ReactNode
}

const DELTA_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const

function DeltaChip({ delta }: { delta: ChartCardDelta }) {
  const Icon = DELTA_ICON[delta.direction]
  const good = delta.direction === 'flat' ? null : (delta.direction === 'up') === delta.upIsGood
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        good === null
          ? 'text-muted-foreground'
          : good
            ? 'text-status-success'
            : 'text-status-error',
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {delta.text}
    </span>
  )
}

export function ChartCard({
  title,
  headline,
  headlineUnit,
  hero = false,
  delta,
  caption,
  table,
  refreshing = false,
  className,
  children,
}: ChartCardProps) {
  const [showTable, setShowTable] = useState(false)
  const captionId = useId()

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="space-y-1 pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          {table && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-mr-2 -mt-1 h-7 px-2 text-xs text-muted-foreground"
              aria-pressed={showTable}
              onClick={() => setShowTable((value) => !value)}
            >
              {showTable ? 'Show chart' : 'Show table'}
            </Button>
          )}
        </div>
        {headline !== undefined && (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p
              className={cn(
                'font-semibold leading-none text-foreground',
                hero ? 'text-5xl' : 'text-3xl',
              )}
            >
              {headline}
              {headlineUnit && (
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                  {headlineUnit}
                </span>
              )}
            </p>
            {delta && <DeltaChip delta={delta} />}
          </div>
        )}
        {caption && (
          <p id={captionId} className="text-xs text-muted-foreground">
            {caption}
          </p>
        )}
      </CardHeader>
      <CardContent
        className={cn('flex-1 transition-opacity duration-300', refreshing && 'opacity-60')}
        aria-busy={refreshing || undefined}

        // F16.3: the chart region is a named figure (the card title),
        // described by the caption -- a screen reader hears what the plot
        // shows, and the "Show table" twin carries every value.
        role="figure"
        aria-label={title}
        aria-describedby={caption ? captionId : undefined}
      >
        {showTable && table ? (
          <Table>
            <TableHeader>
              <TableRow>
                {table.columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <TableCell
                      key={cellIndex}
                      className={cn(typeof cell === 'number' && 'text-right tabular-nums')}
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  )
}
