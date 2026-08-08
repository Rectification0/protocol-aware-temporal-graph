import { BackendPendingState } from '@/components/empty-state'
import { CybersecurityScoreTile } from '@/features/dashboard/CybersecurityScoreTile'
import { MonitoringStatusTile } from '@/features/dashboard/MonitoringStatusTile'
import { SecurityLevelTile } from '@/features/dashboard/SecurityLevelTile'
import { SystemHealthTile } from '@/features/dashboard/SystemHealthTile'
import { AverageResponseTimeTile } from '@/features/security-overview/AverageResponseTimeTile'
import { MonitoredUsersTile } from '@/features/security-overview/MonitoredUsersTile'
import { ProcessedLogsTile } from '@/features/security-overview/ProcessedLogsTile'

// Milestone F14 (Company Security Overview): tasks.md's own intro line
// calls this "largely a second view over F6/F0.12's data at a different
// altitude (company-wide rollup vs. per-tile)" and explicitly says to
// reuse F6's hooks rather than duplicating fetch logic -- F14.1/F14.2
// reuse F6.1/F6.2/F6.4/F6.5's *tiles* directly (not just their hooks),
// since those components already are the honest, tested presentation of
// this exact data; building a second, near-identical tile here would be
// the same kind of pointless duplication F12.1/F12.2/F12.4 already
// avoided for Analytics Visualizations.
export function Component() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Company Security Overview</h1>
        <p className="text-sm text-muted-foreground">
          A company-wide rollup of the same data the Overview page's tiles already show, not a
          second, independently-computed source.
        </p>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Security Posture</h2>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <CybersecurityScoreTile />
          <SecurityLevelTile />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Detection Engine</h2>
        <p className="text-xs text-muted-foreground">
          "Response status" here means whether the detection pipeline is actively processing -- not
          an automated incident-response/SOAR capability, which this repo doesn't implement
          (specs.md &sect;4's explicit non-goal).
        </p>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SystemHealthTile />
          <MonitoringStatusTile />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Coverage</h2>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MonitoredUsersTile />
          <BackendPendingState
            taskRef="F0.13"
            description="Analyzed sessions -- no session concept exists anywhere in this repo; fabricating session boundaries was deliberately avoided (tasks.md F14.3, same reasoning as F10.9)."
          />
          <ProcessedLogsTile />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Response</h2>
        <p className="text-xs text-muted-foreground">
          Average time between a detection and an analyst acknowledging it (Live Monitoring's Ack
          action) -- not time-to-detection, which is measured elsewhere as inference latency.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <AverageResponseTimeTile />
        </div>
      </div>
    </section>
  )
}
