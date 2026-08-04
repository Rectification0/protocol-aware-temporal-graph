import { useMutation } from '@tanstack/react-query'
import { acknowledgeAlert } from '@/api/endpoints'
import type { AlertAckIn } from '@/types/api'

// F4.2: F13.6's alert-acknowledgement action. No corresponding GET/list
// endpoint exists yet (alerts.py is POST-only) so there's no query cache
// entry to invalidate here -- callers that need to reflect an ack
// optimistically (e.g. graying out a row) do so from the mutation's own
// `onSuccess`, not from this hook.
export function useAlertAck() {
  return useMutation({
    mutationFn: (body: AlertAckIn) => acknowledgeAlert(body),
  })
}
