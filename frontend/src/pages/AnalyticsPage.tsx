import { LiveAttackCounter } from '@/features/analytics/LiveAttackCounter'
import { ThreatSeverityChart } from '@/features/analytics/ThreatSeverityChart'
import { ThreatTrendsChart } from '@/features/analytics/ThreatTrendsChart'
import { UserThreatCountsPanel } from '@/features/analytics/UserThreatCountsPanel'

// Milestone F7 (Threat Analytics) assembles the first content on this
// page: F7.1's user threat-tier counts, F7.2's trend chart, F7.3's
// severity distribution, and F7.4's live attack counter. Milestone F8
// (time-range filtering) and F12 (the rest of this page's charts --
// detection accuracy, geographic map, heatmap, top-targeted resources,
// attack-pattern breakdown) build further onto this same page/layout;
// this pass only covers F7.1-F7.4.
export function Component() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Threat Analytics</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <UserThreatCountsPanel />
        <LiveAttackCounter />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ThreatTrendsChart />
        </div>
        <ThreatSeverityChart />
      </div>
    </section>
  )
}
