import { ShieldHalf } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
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

export function Navbar() {
  const session = useAuthStore((state) => state.session)
  const logout = useAuthStore((state) => state.logout)
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate(ROUTES.login)
  }

  return (
    <header className="flex h-14 items-center border-b border-border px-4">
      <div className="flex items-center gap-2">
        <ShieldHalf className="size-5 text-primary" />
        <strong className="font-mono text-sm font-semibold tracking-tight">
          T-GNN SOC Dashboard
        </strong>
      </div>
      {session && (
        <div className="ml-auto flex items-center gap-3">
          <NotificationsPanel />
          <span className="text-sm text-muted-foreground">{session.analyst}</span>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      )}
    </header>
  )
}
