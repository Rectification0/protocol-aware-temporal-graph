import { create } from 'zustand'

// F3.1/F3.4: mock-auth session store. Held only in memory (Zustand's
// default, no persist middleware) rather than localStorage/sessionStorage
// -- tasks.md's own words are "token/session in memory", and there's no
// real token here worth persisting across a reload yet anyway. A page
// refresh intentionally loses the session and returns to /login.
//
// `analyst` is a free-text identifier, not a verified credential -- it
// mirrors the backend's existing mock-auth convention (CLAUDE.md's F0
// addendum: `ApiStateWriter.get_or_create_user()` inserts a placeholder
// `users` row keyed on whatever string the frontend sends). There is no
// password field and no credential store here, per this task's explicit
// "do not build a real credential store client-side" instruction.
//
// "Refresh strategy" (tasks.md F3.1) is explicitly deferred -- there is no
// real token to refresh until F0.11 defines one. `expiresAt` is a
// client-side-only TTL standing in for real token expiry in the
// meantime, so F3.3's session-expiry handling has something concrete to
// check; it carries no security guarantee (nothing server-side enforces
// it) and F0.11 will replace it with a real mechanism.

const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12h

export interface AuthSession {
  analyst: string
  expiresAt: number
}

interface AuthStore {
  session: AuthSession | null
  login: (analyst: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  session: null,
  login: (analyst) => set({ session: { analyst, expiresAt: Date.now() + SESSION_TTL_MS } }),
  logout: () => set({ session: null }),
}))

export function isSessionValid(session: AuthSession | null): session is AuthSession {
  return session !== null && session.expiresAt > Date.now()
}
