import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { isSessionValid, useAuthStore } from '@/store/authStore'
import { ROUTES } from '@/config/routes'

// F3.2: real route guarding against the F3.1 auth store -- redirects to
// /login (preserving the originally-requested path in location state, so
// LoginPage can send the analyst back where they were headed) when there
// is no valid session. The other half of F3.2 -- redirecting on a 401
// response from the API client -- is blocked on F4.3 (the API client
// doesn't exist yet); see tasks.md F3.2's `[~]` status.

export function ProtectedRoute() {
  const session = useAuthStore((state) => state.session)
  const location = useLocation()

  if (!isSessionValid(session)) {
    return <Navigate to={ROUTES.login} state={{ from: location.pathname }} replace />
  }

  return <Outlet />
}
