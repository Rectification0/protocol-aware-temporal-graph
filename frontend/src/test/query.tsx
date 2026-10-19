import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// F16.4: the QueryClient wrapper nearly every hook/component/page test
// needs. `retry: false` so a mocked rejection settles immediately instead
// of running `queryClient.ts`'s real 3-attempt backoff. Returns the client
// too, for tests that inspect the cache (e.g. a query's resolved
// `refetchInterval`) or spy on `invalidateQueries`. Older test files
// inline the same few lines; new ones should use this.
export function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { queryClient, wrapper }
}
