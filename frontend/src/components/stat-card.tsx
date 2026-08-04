import type { ComponentType } from 'react'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// F5.3: dashboard stat/KPI tile (used by F6's executive dashboard grid and
// F14's company-wide rollup). Three built-in states -- normal, `loading`
// (F4's fetch-in-flight convention), and `unavailable` (an inline,
// minimal stand-in for F5.13's empty-state pattern, e.g. F6.1's
// company-score tile before F0.12 exists) -- rather than making every
// caller reimplement all three.

export interface StatCardTrend {
  direction: 'up' | 'down' | 'flat'
  /** Pre-formatted delta text, e.g. "+12%" or "-3 since yesterday". */
  label: string
  /** Whether this direction is good or bad news -- not always "up = good" (e.g. prune rate). */
  tone?: 'positive' | 'negative' | 'neutral'
}

export interface StatCardProps {
  label: string
  value?: React.ReactNode
  icon?: ComponentType<{ className?: string }>
  trend?: StatCardTrend
  loading?: boolean
  /** Renders this message instead of `value` -- e.g. "Not available yet (tasks.md F0.12)". */
  unavailable?: string
  className?: string
}

const TREND_ICON = { up: ArrowUp, down: ArrowDown, flat: Minus } as const

const TREND_TONE_CLASSNAME: Record<NonNullable<StatCardTrend['tone']>, string> = {
  positive: 'text-status-success',
  negative: 'text-status-error',
  neutral: 'text-muted-foreground',
}

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  loading = false,
  unavailable,
  className,
}: StatCardProps) {
  const TrendIcon = trend ? TREND_ICON[trend.direction] : null
  const trendToneClassName = TREND_TONE_CLASSNAME[trend?.tone ?? 'neutral']

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : unavailable ? (
          <p className="text-sm text-muted-foreground">{unavailable}</p>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
              {value}
            </span>
            {trend && TrendIcon && (
              <span className={cn('flex items-center gap-0.5 text-xs', trendToneClassName)}>
                <TrendIcon className="size-3" />
                {trend.label}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
