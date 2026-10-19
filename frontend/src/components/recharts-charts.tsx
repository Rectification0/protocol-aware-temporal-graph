import { useId } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  LabelList,
  Pie,
  PieChart,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/lib/utils'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ui/chart'

// F16.8: the Recharts-backed half of F5.5's chart wrappers, split out of
// `charts.tsx` so Recharts (~110 kB gz, the single largest dependency) can
// load on demand. Import from `@/components/charts`, never from here --
// that module lazy-loads these behind a skeleton.
//
// Visual conventions (reworked per the dataviz skill's mark specs and
// anti-pattern list, after the original F5.5 pass read as flat):
//   - Lines are 2px and solid; multi-series identity is color + legend +
//     selective direct end-labels -- never dash patterns, which read as
//     "projection".
//   - Areas carry a ~10-20% gradient wash under the line, so a trend reads
//     as a shape rather than a thread.
//   - Context marks: a dashed reference line at the range average (dashing
//     is reserved for exactly this kind of baseline) and a ringed dot on
//     the peak bucket.
//   - Bars are <= 24px thick, rounded only at the data end, one color for a
//     single series (coloring nominal bars by value is an anti-pattern).
//   - Tooltips lead with the value, key series with a short line, and give
//     each value's share of the range total.
//   - Gridlines are solid hairlines; marks get a 2px card-colored ring/gap.
//   - Motion is short and off under `prefers-reduced-motion`.
// The categorical palette is `--chart-1..5` (src/index.css), validated
// with the skill's palette script in both modes.

const DEFAULT_SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const

const ANIMATION_MS = 450

function animationEnabled(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

function formatValue(value: number): string {
  return Math.abs(value) >= 1000 ? compactNumber.format(value) : String(Math.round(value * 10) / 10)
}

export interface ChartSeries<T> {
  key: keyof T & string
  label: string
  color?: string
}

function seriesColor<T>(series: ChartSeries<T>, index: number): string {
  return series.color ?? DEFAULT_SERIES_COLORS[index % DEFAULT_SERIES_COLORS.length]
}

function buildConfig<T>(series: ChartSeries<T>[]): ChartConfig {
  return Object.fromEntries(
    series.map((s, index) => [s.key, { label: s.label, color: seriesColor(s, index) }]),
  )
}

// --- Tooltip ----------------------------------------------------------------

interface TooltipRow {
  key: string
  label: string
  color: string
  value: number
  share?: string
}

/** Value-first tooltip: the number is the strong element, the series name
 * secondary, each keyed by a short stroke of the series color. Rendered as
 * React text nodes, so series/category names are never parsed as markup. */
function ValueTooltip({ heading, rows }: { heading?: string; rows: TooltipRow[] }) {
  if (rows.length === 0) return null
  return (
    <div className="min-w-40 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {heading && <p className="mb-1.5 text-muted-foreground">{heading}</p>}
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-0.5 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span className="font-semibold tabular-nums text-foreground">
              {formatValue(row.value)}
            </span>
            <span className="text-muted-foreground">{row.label}</span>
            {row.share && <span className="ml-auto pl-2 text-muted-foreground">{row.share}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function shareOf(value: number, total: number): string | undefined {
  return total > 0 ? `${Math.round((value / total) * 100)}% of total` : undefined
}

// Recharts injects these at runtime into a custom `content` element.
interface InjectedTooltipProps {
  active?: boolean
  label?: string | number
  payload?: ReadonlyArray<{
    dataKey?: unknown
    value?: unknown
    payload?: Record<string, unknown>
  }>
}

// --- Time series (area) -------------------------------------------------------

export interface TimeSeriesChartProps<T extends Record<string, unknown>> {
  data: T[]
  xKey: keyof T & string
  series: ChartSeries<T>[]
  /** A per-point field to head the tooltip with (e.g. the bucket's span). */
  tooltipLabelKey?: keyof T & string
  /** Series whose average line and peak marker are drawn; defaults to the first. */
  referenceKey?: keyof T & string
  height?: number
  className?: string
}

export function TimeSeriesChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  tooltipLabelKey,
  referenceKey,
  height = 280,
  className,
}: TimeSeriesChartProps<T>) {
  const gradientId = useId().replace(/:/g, '')
  const config = buildConfig(series)
  const animate = animationEnabled()

  const totals = Object.fromEntries(
    series.map((s) => [s.key, data.reduce((sum, point) => sum + (Number(point[s.key]) || 0), 0)]),
  )
  const refKey = referenceKey ?? series[0]?.key
  const refValues = refKey ? data.map((point) => Number(point[refKey]) || 0) : []
  const refAverage = refValues.length ? refValues.reduce((a, b) => a + b, 0) / refValues.length : 0
  const refPeak = refValues.length ? Math.max(...refValues) : 0
  const peakIndex = refPeak > 0 ? refValues.indexOf(refPeak) : -1
  const refSeriesIndex = series.findIndex((s) => s.key === refKey)

  // Direct end-labels only where they can't collide: if the series' final
  // values sit close together, nudging labels apart would detach them from
  // their lines -- the legend (always present) carries identity instead.
  const yMax = Math.max(1, ...series.flatMap((s) => data.map((p) => Number(p[s.key]) || 0)))
  const lastValues = series.map((s) => Number(data.at(-1)?.[s.key]) || 0)
  const endLabels =
    series.length <= 4 &&
    lastValues.every((v, i) =>
      lastValues.every((w, j) => i === j || Math.abs(v - w) >= yMax * 0.12),
    )

  return (
    <ChartContainer config={config} className={cn('w-full', className)} style={{ height }}>
      <AreaChart data={data} margin={{ left: 4, right: endLabels ? 96 : 16, top: 20, bottom: 0 }}>
        <defs>
          {series.map((s, index) => (
            <linearGradient key={s.key} id={`${gradientId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={seriesColor(s, index)} stopOpacity={0.22} />
              <stop offset="100%" stopColor={seriesColor(s, index)} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
        <XAxis
          // recharts v3's `dataKey` generic (`TypedDataKey<T, any>`) doesn't
          // unify with a wrapper component's own generic `keyof T & string`
          // -- same root friction as chart.tsx's TooltipContentProps note.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          dataKey={xKey as any}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          className="text-xs"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={36}
          allowDecimals={false}
          tickFormatter={formatValue}
          className="text-xs"
        />
        <ChartTooltip
          cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeOpacity: 0.5 }}
          content={(props: InjectedTooltipProps) =>
            props.active ? (
              <ValueTooltip
                heading={String(
                  (tooltipLabelKey && props.payload?.[0]?.payload?.[tooltipLabelKey]) ??
                    props.label ??
                    '',
                )}
                rows={series.map((s, index) => {
                  const value = Number(props.payload?.[0]?.payload?.[s.key]) || 0
                  return {
                    key: s.key,
                    label: s.label,
                    color: seriesColor(s, index),
                    value,
                    share: shareOf(value, totals[s.key]),
                  }
                })}
              />
            ) : null
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {refAverage > 0 && (
          <ReferenceLine
            y={refAverage}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            strokeOpacity={0.7}
            ifOverflow="extendDomain"
          >
            <Label
              value={`avg ${formatValue(refAverage)}`}
              position="insideTopLeft"
              className="fill-muted-foreground text-[11px]"
            />
          </ReferenceLine>
        )}
        {series.map((s, index) => (
          <Area
            key={s.key}
            type="monotone"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dataKey generic friction, see XAxis note above
            dataKey={s.key as any}
            name={s.label}
            stroke={seriesColor(s, index)}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill={`url(#${gradientId}-${s.key})`}
            dot={false}
            activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2 }}
            isAnimationActive={animate}
            animationDuration={ANIMATION_MS}
          >
            {endLabels && (
              <LabelList
                dataKey={s.key}
                content={(props) => {
                  if (props.index !== data.length - 1) return null
                  const x = Number(props.x) + 8
                  const y = Number(props.y)
                  return (
                    <text x={x} y={y} dominantBaseline="middle" className="fill-foreground text-xs">
                      {s.label.split(' (')[0]}
                    </text>
                  )
                }}
              />
            )}
          </Area>
        ))}
        {peakIndex >= 0 && refSeriesIndex >= 0 && (
          <ReferenceDot
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            x={data[peakIndex][xKey] as any}
            y={refPeak}
            r={5}
            fill={seriesColor(series[refSeriesIndex], refSeriesIndex)}
            stroke="var(--card)"
            strokeWidth={2}
          >
            <Label
              value={`peak ${formatValue(refPeak)}`}
              position="top"
              offset={10}
              className="fill-foreground text-[11px] font-medium"
            />
          </ReferenceDot>
        )}
      </AreaChart>
    </ChartContainer>
  )
}

// --- Category bar chart ---------------------------------------------------

export interface CategoryBarChartProps<T extends Record<string, unknown>> {
  data: T[]
  categoryKey: keyof T & string
  valueKey: keyof T & string
  label: string
  color?: string
  /** Per ui-ux-pro-max chart guidance: bar charts should sort descending by value. Default true. */
  sortDescending?: boolean
  layout?: 'vertical' | 'horizontal'
  /** Appended to value labels, e.g. "%". */
  valueSuffix?: string
  /** Show each bar's share of the total in its tooltip (counts, not rates). */
  showShare?: boolean
  height?: number
  className?: string
}

export function CategoryBarChart<T extends Record<string, unknown>>({
  data,
  categoryKey,
  valueKey,
  label,
  color = DEFAULT_SERIES_COLORS[0],
  sortDescending = true,
  layout = 'vertical',
  valueSuffix = '',
  showShare = false,
  height,
  className,
}: CategoryBarChartProps<T>) {
  const config: ChartConfig = { [valueKey]: { label, color } }
  const sorted = sortDescending
    ? [...data].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]))
    : data
  const isHorizontal = layout === 'horizontal'
  const total = data.reduce((sum, row) => sum + (Number(row[valueKey]) || 0), 0)
  const animate = animationEnabled()
  // Horizontal bars size to their count (36px a row) instead of stretching
  // two bars across a fixed 280px.
  const resolvedHeight = height ?? (isHorizontal ? Math.max(120, sorted.length * 36 + 24) : 280)

  return (
    <ChartContainer
      config={config}
      className={cn('w-full', className)}
      style={{ height: resolvedHeight }}
    >
      <BarChart
        data={sorted}
        layout={isHorizontal ? 'vertical' : 'horizontal'}
        margin={{ left: 4, right: 40, top: 8, bottom: 0 }}
        barCategoryGap="28%"
      >
        <CartesianGrid
          vertical={isHorizontal}
          horizontal={!isHorizontal}
          stroke="var(--border)"
          strokeOpacity={0.6}
        />
        {isHorizontal ? (
          <>
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis
              type="category"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              dataKey={categoryKey as any}
              tickLine={false}
              axisLine={false}
              width={128}
              className="text-xs"
            />
          </>
        ) : (
          <>
            <XAxis
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              dataKey={categoryKey as any}
              tickLine={false}
              axisLine={false}
              className="text-xs"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={36}
              tickFormatter={formatValue}
              className="text-xs"
            />
          </>
        )}
        <ChartTooltip
          cursor={{ fill: 'var(--muted)', fillOpacity: 0.5 }}
          content={(props: InjectedTooltipProps) => {
            const point = props.payload?.[0]
            if (!props.active || !point) return null
            const value = Number(point.value) || 0
            return (
              <ValueTooltip
                heading={String(point.payload?.[categoryKey] ?? '')}
                rows={[
                  {
                    key: valueKey,
                    label,
                    color,
                    value,
                    share: showShare ? shareOf(value, total) : undefined,
                  },
                ]}
              />
            )
          }}
        />
        <Bar
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dataKey generic friction, see XAxis note above
          dataKey={valueKey as any}
          fill={color}
          maxBarSize={24}
          // Rounded at the data end only; square where it meets the baseline.
          radius={isHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
          activeBar={{ fillOpacity: 0.8 }}
          isAnimationActive={animate}
          animationDuration={ANIMATION_MS}
        >
          <LabelList
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            dataKey={valueKey as any}
            position={isHorizontal ? 'right' : 'top'}
            formatter={(value: unknown) => `${formatValue(Number(value) || 0)}${valueSuffix}`}
            className="fill-foreground text-xs"
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

// --- Donut / pie chart ------------------------------------------------------

export interface DonutChartProps<T extends Record<string, unknown>> {
  data: T[]
  nameKey: keyof T & string
  valueKey: keyof T & string
  colors?: string[]
  /** Big centre text -- defaults to the total of `valueKey`. */
  centerLabel?: string
  /** Small text under the centre value, e.g. "entities". */
  centerCaption?: string
  height?: number
  className?: string
}

export function DonutChart<T extends Record<string, unknown>>({
  data,
  nameKey,
  valueKey,
  colors = [...DEFAULT_SERIES_COLORS],
  centerLabel,
  centerCaption,
  height = 220,
  className,
}: DonutChartProps<T>) {
  // ui-ux-pro-max chart guidance: pie/donut should not be used for >5
  // categories (switch to a bar chart instead) -- flagged, not silently
  // truncated, so a caller notices during development.
  if (import.meta.env.DEV && data.length > 5) {
    console.warn(
      `DonutChart: ${data.length} categories passed -- consider CategoryBarChart instead for >5 categories.`,
    )
  }

  const total = data.reduce((sum, d) => sum + (Number(d[valueKey]) || 0), 0)
  const animate = animationEnabled()
  const config: ChartConfig = Object.fromEntries(
    data.map((d, index) => [
      String(d[nameKey]),
      { label: String(d[nameKey]), color: colors[index % colors.length] },
    ]),
  )

  return (
    <div
      className={cn('flex flex-col items-center gap-3 sm:flex-row sm:justify-center', className)}
    >
      <ChartContainer config={config} className="aspect-square shrink-0" style={{ height }}>
        <PieChart>
          <ChartTooltip
            content={(props: InjectedTooltipProps) => {
              const point = props.payload?.[0]
              if (!props.active || !point) return null
              const name = String(point.payload?.[nameKey] ?? '')
              const index = data.findIndex((d) => String(d[nameKey]) === name)
              const value = Number(point.value) || 0
              return (
                <ValueTooltip
                  rows={[
                    {
                      key: name,
                      label: name,
                      color: colors[index % colors.length],
                      value,
                      share: shareOf(value, total),
                    },
                  ]}
                />
              )
            }}
          />
          <Pie
            data={data}
            dataKey={valueKey}
            nameKey={nameKey}
            innerRadius="62%"
            outerRadius="100%"
            // The 2px card-colored stroke is the surface gap between segments.
            stroke="var(--card)"
            strokeWidth={2}
            isAnimationActive={animate}
            animationDuration={ANIMATION_MS}
          >
            {data.map((entry, index) => (
              <Cell key={String(entry[nameKey])} fill={colors[index % colors.length]} />
            ))}
            <Label
              position="center"
              content={({ viewBox }) => {
                if (!viewBox || !('cx' in viewBox) || viewBox.cx == null || viewBox.cy == null) {
                  return null
                }
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={viewBox.cx} className="fill-foreground text-2xl font-semibold">
                      {centerLabel ?? formatValue(total)}
                    </tspan>
                    {centerCaption && (
                      <tspan x={viewBox.cx} dy="1.5em" className="fill-muted-foreground text-xs">
                        {centerCaption}
                      </tspan>
                    )}
                  </text>
                )
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
      {/* Legend with the numbers: identity never rests on color alone, and
          every value is readable without hovering. */}
      <ul className="min-w-36 space-y-1.5 text-sm">
        {data.map((entry, index) => {
          const value = Number(entry[valueKey]) || 0
          return (
            <li key={String(entry[nameKey])} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: colors[index % colors.length] }}
              />
              <span className="text-foreground">{String(entry[nameKey])}</span>
              <span className="ml-auto pl-3 font-medium tabular-nums text-foreground">
                {formatValue(value)}
              </span>
              <span className="w-10 text-right tabular-nums text-muted-foreground">
                {total > 0 ? `${Math.round((value / total) * 100)}%` : '--'}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
