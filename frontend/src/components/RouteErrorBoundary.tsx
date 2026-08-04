import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { ROUTES } from '@/config/routes'

// F2.5: catches render/loader/lazy-import errors thrown by any route
// nested under it (set as the root layout route's `errorElement`) --
// distinct from NotFoundPage, which handles a *matched* but nonexistent
// path (the `path: '*'` route), not a thrown error.

export function RouteErrorBoundary() {
  const error = useRouteError()

  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error'

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <EmptyState
        title="Something went wrong"
        description={message}
        action={
          <Button asChild variant="outline" size="sm">
            <Link to={ROUTES.home}>Back to Overview</Link>
          </Button>
        }
      />
    </div>
  )
}
