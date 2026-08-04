import { useQuery } from '@tanstack/react-query'
import { getHealth } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'

// F4.2: F6.4/F6.5's system-health tile.
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health(),
    queryFn: ({ signal }) => getHealth(signal),
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
}
