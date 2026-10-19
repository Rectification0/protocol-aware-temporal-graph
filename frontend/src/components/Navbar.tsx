import { BellOff, ShieldHalf } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { MobileNav } from '@/components/MobileNav'
import { SectionErrorBoundary } from '@/components/section-error-boundary'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/config/routes'
import { NotificationsPanel } from '@/features/monitoring/NotificationsPanel'
import { useAuthStore } from '@/store/authStore'

// F5.1 (pulled forward from Milestone F5 -- F2.2's app shell depends on
// this existing). Deliberately minimal: a title bar plus F3.3's logout
// control. This comment used to say "real branding/notifications land
// wherever a later milestone actually needs them (F13's alerts, etc.)" --
// F13.4's `NotificationsPanel` is that later milestone, added alongside
// the logout control, gated the same way (only once a session exists).
// F16.9: the bell gets its own error boundary -- the Navbar is outside
// every route-level `errorElement` except the root one, so an uncaught
// throw here would otherwise replace the entire app shell.

export function Navbar() {
  const session = useAuthStore((state) => state.session)
  const logout = useAuthStore((state) => state.logout)
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate(ROUTES.login)
  }

  return (
    <header className="flex h-14 items-center gap-2 border-b border-border px-4">
      {/* F16.1: the drawer trigger, below `md` only (Sidebar is hidden there). */}
      {session && <MobileNav />}
      <div className="flex min-w-0 items-center gap-2">
        <ShieldHalf className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <strong className="truncate font-mono text-sm font-semibold tracking-tight">
          T-GNN SOC Dashboard
        </strong>
      </div>
      {session && (
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <SectionErrorBoundary
            label="Notifications"
            fallback={({ reset }) => (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Notifications unavailable -- retry"
                title="Notifications unavailable -- retry"
                onClick={reset}
              >
                <BellOff />
              </Button>
            )}
          >
            <NotificationsPanel />
          </SectionErrorBoundary>
          <span className="hidden max-w-40 truncate text-sm text-muted-foreground sm:inline">
            {session.analyst}
          </span>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      )}
    </header>
  )
}
