import { Outlet } from 'react-router-dom'
import { useLiveStreamConnection } from '@/api/liveStream'
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
//
// F16.6: neither hook may subscribe *this* component to per-event state --
// the shell re-rendering on every SSE event/heartbeat re-renders Navbar and
// Sidebar with it. Hence `useLiveStreamConnection` (connection only, no
// store subscription) and toasts living in a null-rendering child.
function LiveNotifications({ enabled }: { enabled: boolean }) {
  useLiveNotifications({ enabled })
  return null
}

export function AppShell() {
  const hasSession = isSessionValid(useAuthStore((state) => state.session))
  useLiveStreamConnection({ enabled: hasSession })
  // F15.1: applies the Settings page's theme preference for the whole
  // authenticated app; `/login` (outside this shell) keeps index.html's
  // static default.
  useAppliedTheme()

  return (
    <div className="flex min-h-svh flex-col">
      {/* F16.3: first focusable element -- lets keyboard users jump past the
          navbar and sidebar straight to the page. */}
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      <LiveNotifications enabled={hasSession} />
      <Navbar />
      <div className="flex flex-1">
        <Sidebar />
        {/* F16.1: `min-w-0` lets this flex child shrink below its content's
            intrinsic width, so a wide table scrolls inside its own wrapper
            instead of pushing the whole page sideways on a phone. */}
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
