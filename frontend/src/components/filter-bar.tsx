import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// F5.6: filter bar / filter-chip components (used by F8's date-range +
// filter controls, F9's Detection Matrix filters, F11's Log Explorer).
// This is the generic chip-list primitive -- F8 defines what filters
// actually exist (protocol, severity, time range, etc.); this component
// doesn't know or care what a filter represents, only how to display and
// remove one.

export interface FilterChipData {
  id: string
  label: string
  onRemove: () => void
}

export function FilterChip({ label, onRemove }: Pick<FilterChipData, 'label' | 'onRemove'>) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary py-0.5 pl-2.5 pr-1 text-xs text-secondary-foreground">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter: ${label}`}
        className="rounded-full p-0.5 hover:bg-muted"
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

export interface FilterBarProps {
  filters: FilterChipData[]
  onClearAll?: () => void
  className?: string
  /** Extra controls (e.g. an "Add filter" trigger) rendered before the chips. */
  children?: ReactNode
}

export function FilterBar({ filters, onClearAll, className, children }: FilterBarProps) {
  if (!filters.length && !children) {
    return null
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {children}
      {filters.map((filter) => (
        <FilterChip key={filter.id} label={filter.label} onRemove={filter.onRemove} />
      ))}
      {filters.length > 0 && onClearAll && (
        <Button variant="ghost" size="sm" onClick={onClearAll} className="h-6 px-2 text-xs">
          Clear all
        </Button>
      )}
    </div>
  )
}
