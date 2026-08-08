import { Zap } from 'lucide-react'
import { useLiveStream } from '@/api/liveStream'
import { StatCard } from '@/components/stat-card'
import { computeLiveAttackCount, LIVE_ATTACK_WINDOW_SECONDS } from '@/features/analytics/logic'

const WINDOW_MINUTES = LIVE_ATTACK_WINDOW_SECONDS / 60

// F7.4: live attack counter -- `MotifCompletionEvent`s in a rolling
// window, via F4.6's SSE stream. This tile is F4.6's first real mount
// (`useLiveStream()`), ahead of Milestone F13's broader "wire every
// F6/F7/F9 tile up to the live stream" pass (F13.1) -- tasks.md's own
// F7.4 line names F4.6 as this tile's direct dependency, not a polling
// fallback, so it doesn't wait for F13.
export function LiveAttackCounter() {
  const stream = useLiveStream()
  // Anchored to the stream's own `lastHeartbeatAt`, not a live
  // `Date.now()` read during render (same purity reasoning as F6.3/F6.6)
  // -- until the first heartbeat arrives there's no safe anchor for a
  // "rolling window," so the tile stays in its loading/unavailable state.
  const anchorMs = stream.lastHeartbeatAt
  const count = anchorMs !== null ? computeLiveAttackCount(stream.events, anchorMs) : null
  const isConnecting = stream.status === 'idle' || stream.status === 'connecting'

  return (
    <StatCard
      label="Live Attack Counter"
      icon={Zap}
      loading={isConnecting}
      unavailable={
        !isConnecting && count === null
          ? `Live stream ${stream.status} -- waiting for the first heartbeat`
          : undefined
      }
      value={
        count !== null && (
          <span className="inline-flex items-baseline gap-1.5">
            <span>{count}</span>
            <span className="text-xs font-normal text-muted-foreground">
              in last {WINDOW_MINUTES}m
            </span>
          </span>
        )
      }
    />
  )
}
