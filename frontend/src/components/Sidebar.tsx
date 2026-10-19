import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { NAV_ROUTES } from '@/config/routes'

// F5.2 (pulled forward from Milestone F5 -- F2.2's app shell depends on
// this existing). Nav links are generated from `NAV_ROUTES` (F2.1's route
// registry) so the two can't drift out of sync.
//
// F16.1: the persistent sidebar is desktop-only (`md` and up); below that
// the same `NavLinks` render inside `MobileNav`'s drawer, opened from the
// Navbar. F16.3: links get a visible keyboard focus ring.

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-0.5 px-2">
      {NAV_ROUTES.map((route) => {
        const Icon = route.icon
        return (
          <li key={route.path}>
            <NavLink
              to={route.path}
              end={route.path === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'bg-secondary font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
                )
              }
            >
              <Icon className="size-4" aria-hidden="true" />
              {route.label}
            </NavLink>
          </li>
        )
      })}
    </ul>
  )
}

export function Sidebar() {
  return (
    <nav
      aria-label="Main navigation"
      className="hidden w-56 shrink-0 border-r border-border py-4 md:block"
    >
      <NavLinks />
    </nav>
  )
}
