import type { ComponentType, ReactNode } from 'react'
import { Construction, Inbox, SearchX } from 'lucide-react'
import { cn } from '@/lib/utils'

// F5.13: empty-state components -- no data / no results / feature-pending
// -backend states, used wherever an F0 `[BACKEND TODO]` isn't done yet
// (e.g. F6.1's company-score tile, F10.7-10.9's IP/device/session panels)
// so the UI degrades honestly instead of showing fabricated data.

export interface EmptyStateProps {
  icon?: ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8 text-center',
        className,
      )}
    >
      <Icon className="size-8 text-muted-foreground" />
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  )
}

/** No rows matched the current search/filters -- distinct from "no data at all". */
export function NoResultsState({ className }: { className?: string }) {
  return (
    <EmptyState
      icon={SearchX}
      title="No results"
      description="Try adjusting your search or filters."
      className={className}
    />
  )
}

/**
 * A feature that depends on a documented backend gap (tasks.md's
 * `[BACKEND TODO]` items, e.g. F0.12-F0.14) -- names the gap explicitly
 * rather than showing a generic or fabricated empty state, so it's clear
 * this is a known, tracked limitation and not a bug.
 */
export function BackendPendingState({
  taskRef,
  description,
  className,
}: {
  /** e.g. "F0.12" */
  taskRef: string
  description?: string
  className?: string
}) {
  return (
    <EmptyState
      icon={Construction}
      title="Not available yet"
      description={
        description ?? `This depends on tasks.md ${taskRef}, which isn't implemented yet.`
      }
      className={className}
    />
  )
}
