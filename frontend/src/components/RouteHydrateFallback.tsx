// Without a `hydrateFallbackElement`, a data router with `lazy` routes
// (F2.3's per-page code splitting) renders nothing at all for its matched
// branch until that page's chunk finishes loading -- normally too fast to
// notice, but slow enough under load (e.g. a busy test run, a cold cache)
// to be a real blank-screen flash. One shared, minimal fallback per
// top-level branch (root layout + the standalone `/login` route) avoids
// that, matching `RouteErrorBoundary`'s sibling role for the error case.

export function RouteHydrateFallback() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6 text-sm text-muted-foreground">
      Loading…
    </div>
  )
}
