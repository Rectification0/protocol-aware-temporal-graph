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
// No Recharts primitive for this -- a plain CSS grid with an intensity
// scale is the standard approach. Value is always exposed via `title`
// (native tooltip) and visible on focus, per "don't rely on color alone".

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
  const max = Math.max(1, ...values.flat())

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="border-separate border-spacing-1">
        <thead>
          <tr>
            <th aria-hidden="true" />
            {columnLabels.map((label) => (
              <th
                key={label}
                scope="col"
                className="px-1 text-xs font-normal text-muted-foreground"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowLabels.map((rowLabel, rowIndex) => (
            <tr key={rowLabel}>
              <th scope="row" className="pr-2 text-right text-xs font-normal text-muted-foreground">
                {rowLabel}
              </th>
              {columnLabels.map((columnLabel, columnIndex) => {
                const value = values[rowIndex]?.[columnIndex] ?? 0
                const intensity = value / max

                return (
                  <td key={columnLabel}>
                    <div
                      role="img"
                      aria-label={`${rowLabel}, ${columnLabel}: ${valueFormatter(value)}`}
                      title={`${rowLabel}, ${columnLabel}: ${valueFormatter(value)}`}
                      className="size-6 rounded-sm"
                      style={{
                        backgroundColor: `color-mix(in srgb, var(--chart-1) ${Math.round(intensity * 100)}%, var(--card))`,
                      }}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
