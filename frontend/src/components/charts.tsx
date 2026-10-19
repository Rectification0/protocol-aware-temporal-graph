import { lazy, Suspense, type ComponentType } from 'react'
import { ChartSkeleton } from '@/components/skeletons'
import { cn } from '@/lib/utils'
import type {
  CategoryBarChartProps,
  DonutChartProps,
  TimeSeriesChartProps,
} from '@/components/recharts-charts'

// F5.5's chart wrappers, as consumed by every chart in the app.
//
// F16.8: the three Recharts-backed charts are lazy-loaded from
// `recharts-charts.tsx` -- Recharts is ~110 kB gz, almost all of the
// Analytics page's chunk -- so a chart's card, title and data fetch render
// immediately and only the plot itself waits on the library, behind a
// same-height `ChartSkeleton` (no layout shift). Every consumer gets this
// by importing from here; the dynamic import is shared, so Recharts
// downloads once however many charts mount. `HeatmapChart` is plain
// CSS-grid markup with no Recharts dependency, so it stays eager below.

export type { ChartSeries } from '@/components/recharts-charts'
export type { CategoryBarChartProps, DonutChartProps, TimeSeriesChartProps }

const loadRecharts = () => import('@/components/recharts-charts')

// `lazy()` erases generics, so each chart is re-exposed through a generic
// wrapper with the original props type; the cast is only at that seam.
type AnyRecord = Record<string, unknown>

const LazyTimeSeriesChart = lazy(() =>
  loadRecharts().then((m) => ({
    default: m.TimeSeriesChart as ComponentType<TimeSeriesChartProps<AnyRecord>>,
  })),
)
const LazyCategoryBarChart = lazy(() =>
  loadRecharts().then((m) => ({
    default: m.CategoryBarChart as ComponentType<CategoryBarChartProps<AnyRecord>>,
  })),
)
const LazyDonutChart = lazy(() =>
  loadRecharts().then((m) => ({
    default: m.DonutChart as ComponentType<DonutChartProps<AnyRecord>>,
  })),
)

const DEFAULT_CHART_HEIGHT = 280

export function TimeSeriesChart<T extends AnyRecord>(props: TimeSeriesChartProps<T>) {
  return (
    <Suspense
      fallback={
        <ChartSkeleton height={props.height ?? DEFAULT_CHART_HEIGHT} className={props.className} />
      }
    >
      <LazyTimeSeriesChart {...(props as unknown as TimeSeriesChartProps<AnyRecord>)} />
    </Suspense>
  )
}

export function CategoryBarChart<T extends AnyRecord>(props: CategoryBarChartProps<T>) {
  return (
    <Suspense
      fallback={
        <ChartSkeleton height={props.height ?? DEFAULT_CHART_HEIGHT} className={props.className} />
      }
    >
      <LazyCategoryBarChart {...(props as unknown as CategoryBarChartProps<AnyRecord>)} />
    </Suspense>
  )
}

export function DonutChart<T extends AnyRecord>(props: DonutChartProps<T>) {
  return (
    <Suspense
      fallback={
        <ChartSkeleton height={props.height ?? DEFAULT_CHART_HEIGHT} className={props.className} />
      }
    >
      <LazyDonutChart {...(props as unknown as DonutChartProps<AnyRecord>)} />
    </Suspense>
  )
}

// --- Heatmap (e.g. F12.6's time-of-day x day-of-week attack frequency) -----
//
// No Recharts primitive for this -- a plain CSS grid. Magnitude is a
// *binned* single-hue scale (`--heat-1..4`, validated as an ordinal ramp in
// both modes; empty cells use `--muted`) rather than a continuous blend, so
// low counts stay visible and adjacent bins stay distinguishable. A scale
// legend says what the steps mean, the busiest cell is ringed, and every
// value is exposed via `title`/`aria-label` -- never color alone.

const HEAT_BINS = 4

function heatStep(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0
  return Math.min(HEAT_BINS, Math.ceil((value / max) * HEAT_BINS))
}

function heatColor(step: number): string {
  return step === 0 ? 'var(--muted)' : `var(--heat-${step})`
}

export interface HeatmapChartProps {
  rowLabels: string[]
  columnLabels: string[]
  /** values[row][column] */
  values: number[][]
  valueFormatter?: (value: number) => string
  className?: string
}

export function HeatmapChart({
  rowLabels,
  columnLabels,
  values,
  valueFormatter = (v) => String(v),
  className,
}: HeatmapChartProps) {
  const max = Math.max(0, ...values.flat())
  let peak: { row: number; column: number } | null = null
  values.forEach((row, r) =>
    row.forEach((value, c) => {
      if (value > 0 && (peak === null || value > (values[peak.row]?.[peak.column] ?? 0))) {
        peak = { row: r, column: c }
      }
    }),
  )
  const peakCell = peak as { row: number; column: number } | null

  // Bin boundaries for the legend, e.g. max 8 -> 1-2, 3-4, 5-6, 7-8.
  const binLabels = Array.from({ length: HEAT_BINS }, (_, i) => {
    const low = Math.floor((i / HEAT_BINS) * max) + 1
    const high = Math.ceil(((i + 1) / HEAT_BINS) * max)
    return low >= high ? valueFormatter(high) : `${valueFormatter(low)}–${valueFormatter(high)}`
  })

  return (
    <div className={cn('space-y-3', className)}>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[2px]">
          <thead>
            <tr>
              <th aria-hidden="true" />
              {columnLabels.map((label, index) => (
                <th
                  key={label}
                  scope="col"
                  className="px-0.5 text-[10px] font-normal text-muted-foreground"
                >
                  {/* Every third hour -- all 24 labels crowd into noise. */}
                  {index % 3 === 0 ? label : <span className="sr-only">{label}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowLabels.map((rowLabel, rowIndex) => (
              <tr key={rowLabel}>
                <th
                  scope="row"
                  className="pr-2 text-right text-xs font-normal text-muted-foreground"
                >
                  {rowLabel}
                </th>
                {columnLabels.map((columnLabel, columnIndex) => {
                  const value = values[rowIndex]?.[columnIndex] ?? 0
                  const isPeak = peakCell?.row === rowIndex && peakCell?.column === columnIndex
                  const text = `${rowLabel}, ${columnLabel}: ${valueFormatter(value)}${isPeak ? ' (busiest)' : ''}`
                  return (
                    <td key={columnLabel} className="p-0">
                      <div
                        role="img"
                        aria-label={text}
                        title={text}
                        data-peak={isPeak || undefined}
                        className={cn(
                          'size-5 rounded-[3px] transition-transform duration-150 hover:scale-125 sm:size-6',
                          isPeak && 'ring-2 ring-foreground ring-offset-1 ring-offset-card',
                        )}
                        style={{ backgroundColor: heatColor(heatStep(value, max)) }}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {max > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-[3px]" style={{ backgroundColor: heatColor(0) }} />
            none
          </span>
          {binLabels.map((label, i) => (
            <span key={label + i} className="inline-flex items-center gap-1.5">
              <span
                className="size-3 rounded-[3px]"
                style={{ backgroundColor: heatColor(i + 1) }}
              />
              {label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-[3px] ring-2 ring-foreground ring-offset-1 ring-offset-card" />
            busiest
          </span>
        </div>
      )}
    </div>
  )
}
