import { useQuery } from '@tanstack/react-query'
import { getEntityForensics, getPrunedEdge } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'

// F4.2: F10's User Investigation timeline -- a fixed `[start, end]` window
// of an entity's already-pruned (cold-storage) activity. Long `staleTime`
// since this is historical Neo4j data, not a live feed; re-querying the
// same window is only useful after a new prune for that entity has
// happened, which F13's live stream (F4.6) surfaces separately.
export function useEntityForensics(entityId: string, start: number, end: number) {
  return useQuery({
    queryKey: queryKeys.entityForensics(entityId, start, end),
    queryFn: ({ signal }) => getEntityForensics(entityId, start, end, signal),
    enabled: Boolean(entityId),
    staleTime: 60_000,
  })
}

// Resolves a `MotifCompletionEvent.matched_edges` id back to full metadata
// (motif_engine.py's own use case for this endpoint, per forensics.py's
// docstring). A pruned edge's record never changes once written, and a
// 404 ("never pruned, or still active") is a real, expected outcome the
// generic retry policy (F4.4) already declines to retry.
export function usePrunedEdge(edgeId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.prunedEdge(edgeId ?? ''),
    queryFn: ({ signal }) => getPrunedEdge(edgeId!, signal),
    enabled: Boolean(edgeId),
    staleTime: Infinity,
  })
}
