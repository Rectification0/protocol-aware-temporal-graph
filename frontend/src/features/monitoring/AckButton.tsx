import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAlertAck } from '@/hooks/api'
import { useAlertAckStore } from '@/store/alertAckStore'
import { useAuthStore } from '@/store/authStore'

// F13.6: the frontend half tasks.md's own F13.6 note says is still
// missing -- the API side (`POST /api/alerts/ack`) landed back in F0.
// `useAlertAck()` has no matching GET/list endpoint to invalidate/refetch
// (that hook's own comment), so "acknowledged" here is reflected via
// `alertAckStore`'s client-side, session-scoped record, updated from this
// mutation's own `onSuccess` -- the pattern that hook's comment already
// prescribes.
export function AckButton({
  detectionType,
  detectionRef,
}: {
  detectionType: string
  detectionRef: string
}) {
  const analyst = useAuthStore((state) => state.session?.analyst ?? null)
  const acked = useAlertAckStore((state) => state.isAcked(detectionType, detectionRef))
  const markAcked = useAlertAckStore((state) => state.markAcked)
  const ack = useAlertAck()

  if (acked) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-status-success">
        <Check className="size-3.5" />
        Acknowledged
      </span>
    )
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 px-2 text-xs"
      disabled={ack.isPending}
      onClick={() =>
        ack.mutate(
          { detection_type: detectionType, detection_ref: detectionRef, analyst },
          { onSuccess: () => markAcked(detectionType, detectionRef) },
        )
      }
    >
      Ack
    </Button>
  )
}
