import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PaginationState } from '@tanstack/react-table'
import {
  getConfigCapabilities,
  listConfigChanges,
  listMotifConfig,
  listProtocolConfig,
  updateMotifWindow,
  updateProtocolLambda,
} from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { toOffsetParams, toPaginatedResult } from '@/hooks/api/pagination'
import type { MotifWindowIn, ProtocolLambdaIn } from '@/types/api'

// F0.9: config rarely changes by hand, so a long stale time. FB.1 edits
// invalidate these explicitly on success, so the long staleTime never
// hides the dashboard's own change.
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

// --- Frontend Backlog FB.1: config write path --------------------------

export function useConfigCapabilities() {
  return useQuery({
    queryKey: queryKeys.configCapabilities(),
    queryFn: ({ signal }) => getConfigCapabilities(signal),
    staleTime: 5 * 60_000,
  })
}

export function useConfigChanges(pagination: PaginationState) {
  const params = toOffsetParams(pagination)
  const query = useQuery({
    queryKey: queryKeys.configChanges(params),
    queryFn: ({ signal }) => listConfigChanges({ ...params, signal }),
    staleTime: 30_000,
  })
  return { ...query, ...toPaginatedResult(query.data, params) }
}

function useInvalidateConfig() {
  const queryClient = useQueryClient()
  // Prefix ['config'] covers protocols, motifs and the change history.
  return () => queryClient.invalidateQueries({ queryKey: ['config'] })
}

export function useUpdateProtocolLambda() {
  const invalidate = useInvalidateConfig()
  return useMutation({
    mutationFn: ({ protocol, ...body }: ProtocolLambdaIn & { protocol: string }) =>
      updateProtocolLambda(protocol, body),
    onSuccess: () => void invalidate(),
  })
}

export function useUpdateMotifWindow() {
  const invalidate = useInvalidateConfig()
  return useMutation({
    mutationFn: ({ name, ...body }: MotifWindowIn & { name: string }) =>
      updateMotifWindow(name, body),
    onSuccess: () => void invalidate(),
  })
}
