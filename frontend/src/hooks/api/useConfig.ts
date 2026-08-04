import { useQuery } from '@tanstack/react-query'
import { listMotifConfig, listProtocolConfig } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'

// F4.2: F15's Settings page + F9's "detection category" column. Both
// registries only change via a hand-edited YAML file + `reload()`
// (docs/operational-runbook.md) -- near-static, no `refetchInterval`; a
// 5-minute `staleTime` is just to avoid re-fetching on every remount of a
// settings panel within the same session.
export function useProtocolConfig() {
  return useQuery({
    queryKey: queryKeys.protocolConfig(),
    queryFn: ({ signal }) => listProtocolConfig(signal),
    staleTime: 5 * 60_000,
  })
}

export function useMotifConfig() {
  return useQuery({
    queryKey: queryKeys.motifConfig(),
    queryFn: ({ signal }) => listMotifConfig(signal),
    staleTime: 5 * 60_000,
  })
}
