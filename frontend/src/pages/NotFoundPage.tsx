import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { ROUTES } from '@/config/routes'

export function Component() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        title="Page not found"
        description="The page you're looking for doesn't exist or was moved."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to={ROUTES.home}>Back to Overview</Link>
          </Button>
        }
      />
    </div>
  )
}
