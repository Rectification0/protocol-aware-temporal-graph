import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

// F5.12: loading-skeleton patterns beyond what's already built into
// StatCard/DataTable (F5.3/F5.4 each accept their own `loading` prop and
// render a Skeleton internally, matching their exact final layout -- no
// separate skeleton component needed for either). These two cover the
// two F5 components that don't have a matching in-place `loading` prop:
// charts (F5.5) and simple row-based lists (F10/F11's user/log lists).

export function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-4 rounded-full" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-20" />
      </CardContent>
    </Card>
  )
}

export function ChartSkeleton({
  height = 280,
  className,
}: {
  height?: number
  className?: string
}) {
  return <Skeleton className={cn('w-full', className)} style={{ height }} />
}

export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  )
}
