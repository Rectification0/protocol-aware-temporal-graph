import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { ROUTES } from '@/config/routes'

// F2.5: catches render/loader/lazy-import errors thrown by any route
// nested under it (set as the root layout route's `errorElement`) --
// distinct from NotFoundPage, which handles a *matched* but nonexistent
// path (the `path: '*'` route), not a thrown error.
//
// F16.9: also mounted one level down (`inShell`), on the authenticated
// layout route, so a page that throws renders this inside AppShell's
// Outlet -- Navbar/Sidebar stay usable to navigate away -- instead of
// bubbling up to the root boundary, which replaces the whole shell. The
// root instance remains the backstop for the shell itself throwing.

export function RouteErrorBoundary({ inShell = false }: { inShell?: boolean }) {
  const error = useRouteError()

  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unknown error'

  return (
    <div
      className={
        inShell
          ? 'flex items-center justify-center py-12'
          : 'flex min-h-svh items-center justify-center p-6'
      }
    >
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
