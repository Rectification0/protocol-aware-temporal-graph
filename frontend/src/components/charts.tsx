import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '@/lib/utils'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

// F5.5: chart wrapper components around Recharts (F1.4's charting
// library) for F12's analytics visualizations. Conventions baked in per
// the ui-ux-pro-max skill's chart/accessibility guidance (not just
// picked arbitrarily): legend + tooltip always present, multi-series
// line charts differentiate by stroke style (not color alone) for
// colorblind users, bar charts sort descending by default and always
// show value labels, and the categorical palette is `--chart-1..5`
// (src/index.css) -- a separate token set from the severity scale
// (F5.14), since chart series and detection severity mean different
// things.

const DEFAULT_SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const

const LINE_DASH_PATTERNS = ['0', '6 4', '2 3', '8 3 2 3', '1 3'] as const

export interface ChartSeries<T> {
  key: keyof T & string
  label: string
  color?: string
}

function buildConfig<T>(series: ChartSeries<T>[]): ChartConfig {
  return Object.fromEntries(
    series.map((s, index) => [
      s.key,
      {
        label: s.label,
        color: s.color ?? DEFAULT_SERIES_COLORS[index % DEFAULT_SERIES_COLORS.length],
      },
    ]),
  )
}

// --- Time-series / line chart --------------------------------------------

export interface TimeSeriesChartProps<T extends Record<string, unknown>> {
  data: T[]
  xKey: keyof T & string
  series: ChartSeries<T>[]
  height?: number
  className?: string
}

export function TimeSeriesChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 280,
  className,
}: TimeSeriesChartProps<T>) {
  const config = buildConfig(series)

  return (
    <ChartContainer config={config} className={cn('w-full', className)} style={{ height }}>
      <LineChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
        <XAxis
          // recharts v3's `dataKey` generic (`TypedDataKey<T, any>`) doesn't
          // unify with a wrapper component's own generic `keyof T & string`
          // -- same root friction as chart.tsx's TooltipContentProps note.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          dataKey={xKey as any}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          className="text-xs"
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} className="text-xs" width={40} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((s, index) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={`var(--color-${s.key})`}
            strokeWidth={2}
            strokeDasharray={LINE_DASH_PATTERNS[index % LINE_DASH_PATTERNS.length]}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
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
  height = 280,
  className,
}: CategoryBarChartProps<T>) {
  const config: ChartConfig = { [valueKey]: { label, color } }
  const sorted = sortDescending
    ? [...data].sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]))
    : data
  const isHorizontal = layout === 'horizontal'

  return (
    <ChartContainer config={config} className={cn('w-full', className)} style={{ height }}>
      <BarChart
        data={sorted}
        layout={isHorizontal ? 'vertical' : 'horizontal'}
        margin={{ left: 8, right: 24, top: 8, bottom: 0 }}
      >
        <CartesianGrid
          vertical={isHorizontal}
          horizontal={!isHorizontal}
          stroke="var(--border)"
          strokeOpacity={0.5}
        />
        {isHorizontal ? (
          <>
            <XAxis type="number" tickLine={false} axisLine={false} className="text-xs" />
            <YAxis
              type="category"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              dataKey={categoryKey as any}
              tickLine={false}
              axisLine={false}
              width={96}
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
            <YAxis tickLine={false} axisLine={false} width={40} className="text-xs" />
          </>
        )}
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dataKey generic friction, see XAxis note above
          dataKey={valueKey as any}
          fill={`var(--color-${valueKey})`}
          radius={4}
        >
          <LabelList
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            dataKey={valueKey as any}
            position={isHorizontal ? 'right' : 'top'}
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
  centerLabel?: string
  height?: number
  className?: string
}

export function DonutChart<T extends Record<string, unknown>>({
  data,
  nameKey,
  valueKey,
  colors = [...DEFAULT_SERIES_COLORS],
  centerLabel,
  height = 280,
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

  const config: ChartConfig = Object.fromEntries(
    data.map((d, index) => [
      String(d[nameKey]),
      { label: String(d[nameKey]), color: colors[index % colors.length] },
    ]),
  )

  return (
    <ChartContainer
      config={config}
      className={cn('mx-auto aspect-square', className)}
      style={{ height }}
    >
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent hideLabel nameKey={nameKey} />} />
        <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius="60%" strokeWidth={2}>
          {data.map((entry, index) => (
            <Cell key={String(entry[nameKey])} fill={colors[index % colors.length]} />
          ))}
          {centerLabel && (
            <Label
              position="center"
              content={({ viewBox }) => {
                if (!viewBox || !('cx' in viewBox) || viewBox.cx == null || viewBox.cy == null) {
                  return null
                }
                return (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan className="fill-foreground text-lg font-semibold">{centerLabel}</tspan>
                  </text>
                )
              }}
            />
          )}
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey={nameKey} />} />
      </PieChart>
    </ChartContainer>
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
