import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PaginationState } from '@tanstack/react-table'
import { listMotifFeedback, submitMotifFeedback } from '@/api/endpoints'
import { queryKeys } from '@/api/queryKeys'
import { toOffsetParams, toPaginatedResult } from '@/hooks/api/pagination'
import type { MotifFeedbackIn } from '@/types/api'

// F4.2/F4.5: analyst true/false-positive dispositions (F9.5's groundwork).
// Feedback only changes when an analyst acts, so no `refetchInterval` --
// the submit mutation below invalidates this list directly instead.
export function useMotifFeedback(pagination: PaginationState) {
  const params = toOffsetParams(pagination)
  const query = useQuery({
    queryKey: queryKeys.motifFeedback(params),
    queryFn: ({ signal }) => listMotifFeedback({ ...params, signal }),
    staleTime: 30_000,
  })
  return { ...query, ...toPaginatedResult(query.data, params) }
}

export function useSubmitMotifFeedback() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: MotifFeedbackIn) => submitMotifFeedback(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['motifs', 'feedback'] })
    },
  })
}
