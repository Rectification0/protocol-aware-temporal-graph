import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError, getErrorMessage } from '@/api/client'
import { toast } from '@/components/toast'
import { ROUTES } from '@/config/routes'
import { router } from '@/router'
import { useAuthStore } from '@/store/authStore'

// F4.4: retry policy shared by every query. A 4xx response means the
// request itself was wrong (bad params, not found, unauthorized) --
// retrying it just reproduces the same failure, so only retry on 5xx
// (transient backend/infra trouble, e.g. a Postgres blip surfaced as a
// 503 by `require_postgres`) or a genuine network failure (no `status` at
// all -- `ApiNetworkError`). 429 is included on the offchance rate
// limiting is ever added in front of this API. Caps at 3 attempts total;
// TanStack Query's default exponential backoff (1s, 2s, 4s, capped at
// 30s) applies as-is.
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 3) return false
  if (error instanceof ApiError) {
    return error.status >= 500 || error.status === 429
  }
  return true
}

// F4.3: one place that turns any query/mutation failure into a toast, and
// a 401 (once F0.11 makes that a real possible response -- today no
// endpoint requires auth, so this path is unexercised in practice but
// ready for when it isn't) into a forced logout + redirect-to-login, the
// other half of F3.2 that was blocked on this client existing.
export function handleGlobalError(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) {
    useAuthStore.getState().logout()
    void router.navigate(ROUTES.login)
    toast.error('Your session has expired -- please log in again.')
    return
  }
  toast.error(getErrorMessage(error))
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      // F5.12's skeletons key off `isLoading` (no cached data yet); a
      // background refetch instead sets `isFetching` without disturbing
      // already-rendered data, per F4.3's loading-state convention.
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Mutations are POSTs (motif feedback, alert acks) -- auto-retrying
      // one risks a duplicate submission, so failures surface to the
      // caller (and the toast below) instead of retrying silently.
      retry: false,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      // Only toast a query's *first* failure (no cached data to fall back
      // on yet). A query that already has data and is polling in the
      // background (F4.2's refetchInterval endpoints) shouldn't pop a
      // toast on every missed interval -- the stale-but-present data is
      // still shown, which is the whole point of keeping it cached.
      if (query.state.data !== undefined) return
      handleGlobalError(error)
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => handleGlobalError(error),
  }),
})
