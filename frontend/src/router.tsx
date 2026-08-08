import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary'
import { RouteHydrateFallback } from '@/components/RouteHydrateFallback'
import { ROUTES } from '@/config/routes'

// F2.1's route list + F2.3's code splitting: each leaf route uses React
// Router's `lazy` (dynamic import per page, resolved to a `Component`
// export) rather than a manual `React.lazy`/`Suspense` pair -- the data
// router already awaits it during navigation, so no extra boilerplate is
// needed per page.
//
// `routes` is exported separately from `router` so tests can feed the
// same route tree into `createMemoryRouter` instead of the browser router
// (which reads/writes real browser history).

export const routes: RouteObject[] = [
  {
    path: ROUTES.home,
    element: <AppShell />,
    errorElement: <RouteErrorBoundary />,
    hydrateFallbackElement: <RouteHydrateFallback />,
    children: [
      {
        // F2.4: stubbed auth gate, currently a pass-through.
        element: <ProtectedRoute />,
        children: [
          { index: true, lazy: () => import('@/pages/HomePage') },
          { path: 'analytics', lazy: () => import('@/pages/AnalyticsPage') },
          // F10.1: the user-list page, a sibling of the F10.2 detail
          // route below rather than a new top-level path -- see
          // `config/routes.ts`'s `ROUTES.users` comment.
          { path: 'investigation', lazy: () => import('@/pages/UserListPage') },
          { path: 'investigation/:entityId', lazy: () => import('@/pages/InvestigationPage') },
          { path: 'detections', lazy: () => import('@/pages/DetectionsPage') },
          { path: 'logs', lazy: () => import('@/pages/LogsPage') },
          { path: 'monitoring', lazy: () => import('@/pages/MonitoringPage') },
          { path: 'settings', lazy: () => import('@/pages/SettingsPage') },
        ],
      },
      // F2.5: unmatched path under the shell.
      { path: '*', lazy: () => import('@/pages/NotFoundPage') },
    ],
  },
  // Outside the shell -- no Navbar/Sidebar/auth gate on the login page itself.
  {
    path: ROUTES.login,
    lazy: () => import('@/pages/LoginPage'),
    hydrateFallbackElement: <RouteHydrateFallback />,
  },
]

export const router = createBrowserRouter(routes)
