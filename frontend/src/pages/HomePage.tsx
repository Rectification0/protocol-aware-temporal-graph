import { SectionErrorBoundary } from '@/components/section-error-boundary'
import { CybersecurityScoreTile } from '@/features/dashboard/CybersecurityScoreTile'
import { LastAnalysisTile } from '@/features/dashboard/LastAnalysisTile'
import { MonitoringStatusTile } from '@/features/dashboard/MonitoringStatusTile'
import { SecurityLevelTile } from '@/features/dashboard/SecurityLevelTile'
import { SystemHealthTile } from '@/features/dashboard/SystemHealthTile'
import { ThreatStatusTile } from '@/features/dashboard/ThreatStatusTile'

// F6.7: the executive-dashboard grid, assembled from F6.1-F6.6's tiles
// (each an F5.3 `StatCard`). Each tile fetches its own data independently
// (co-located with the component that renders it, TanStack Query's usual
// pattern) rather than this page threading props down, so one tile's
// slow/failed query never blocks the others from rendering.
export function Component() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SectionErrorBoundary label="Cybersecurity score">
          <CybersecurityScoreTile />
        </SectionErrorBoundary>
        <SectionErrorBoundary label="Security level">
          <SecurityLevelTile />
        </SectionErrorBoundary>
        <SectionErrorBoundary label="Threat status">
          <ThreatStatusTile />
        </SectionErrorBoundary>
        <SectionErrorBoundary label="System health">
          <SystemHealthTile />
        </SectionErrorBoundary>
        <SectionErrorBoundary label="Monitoring status">
          <MonitoringStatusTile />
        </SectionErrorBoundary>
        <SectionErrorBoundary label="Last analysis">
          <LastAnalysisTile />
        </SectionErrorBoundary>
      </div>
    </section>
  )
}
