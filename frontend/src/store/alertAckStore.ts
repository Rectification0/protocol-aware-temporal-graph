import { create } from 'zustand'
import { ackKey } from '@/features/monitoring/logic'

// F13.6: client-side record of which detections this session has
// acknowledged. `useAlertAck()` (F4.2) is POST-only -- `alerts.py` has no
// GET/list endpoint to read acknowledgement state back (that hook's own
// comment already documents this), so there is no way to hydrate this
// from the server on load. This store is therefore honestly
// session-scoped: an ack made here is genuinely persisted server-side
// (the `alert_acknowledgements` table), but a reload or a different
// tab/session won't show it as acknowledged until a GET endpoint exists.

interface AlertAckStore {
  ackedKeys: Record<string, true>
  markAcked: (detectionType: string, detectionRef: string) => void
  isAcked: (detectionType: string, detectionRef: string) => boolean
}

export const useAlertAckStore = create<AlertAckStore>((set, get) => ({
  ackedKeys: {},
  markAcked: (detectionType, detectionRef) =>
    set((state) => ({
      ackedKeys: { ...state.ackedKeys, [ackKey(detectionType, detectionRef)]: true },
    })),
  isAcked: (detectionType, detectionRef) =>
    Boolean(get().ackedKeys[ackKey(detectionType, detectionRef)]),
}))
