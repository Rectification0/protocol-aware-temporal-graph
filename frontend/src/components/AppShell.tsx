import { Outlet } from 'react-router-dom'
import { useLiveStream } from '@/api/liveStream'
import { Navbar } from '@/components/Navbar'
import { Sidebar } from '@/components/Sidebar'
import { useLiveNotifications } from '@/features/monitoring/useLiveNotifications'
import { isSessionValid, useAuthStore } from '@/store/authStore'
import { useAppliedTheme } from '@/store/themeStore'

// F2.2: Navbar + Sidebar + content outlet. This is the root layout route
// for every authenticated page -- /login (outside the shell) is not a
// child of this route.
//
// F13.1: this is also the single owner of F4.6's SSE connection --
// `useLiveStream()` opens one `EventSource` per mount, so mounting it
// here once (rather than letting whichever page happens to have a live
// tile, e.g. F7.4's `LiveAttackCounter`, each open its own) is what
// actually makes F6/F7/F9's tiles receive push updates while any page is
// mounted, not just while that one tile's own page is. Gated on a valid
// session (this route renders even for an unauthenticated visitor mid-
// redirect to `/login`, per `ProtectedRoute`'s placement one level down)
// so an unauthenticated visitor never opens a live connection.
// `useLiveNotifications()` (F13.4) piggybacks on the same store this
// connection feeds, toasting newly-arrived alert-worthy events.
export function AppShell() {
  const hasSession = isSessionValid(useAuthStore((state) => state.session))
  useLiveStream({ enabled: hasSession })
  useLiveNotifications({ enabled: hasSession })
  // F15.1: applies the Settings page's theme preference for the whole
  // authenticated app; `/login` (outside this shell) keeps index.html's
  // static default.
  useAppliedTheme()

  return (
    <div className="flex min-h-svh flex-col">
      <Navbar />
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
