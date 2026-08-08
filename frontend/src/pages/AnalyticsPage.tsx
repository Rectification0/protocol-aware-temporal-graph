import { TimeRangeFilter } from '@/components/time-range-filter'
import { AttackFrequencyHeatmap } from '@/features/analytics/AttackFrequencyHeatmap'
import { AttackPatternsChart } from '@/features/analytics/AttackPatternsChart'
import { AttacksInRangeTile } from '@/features/analytics/AttacksInRangeTile'
import { AvgAnomaliesPerHourTile } from '@/features/analytics/AvgAnomaliesPerHourTile'
import { DetectionAccuracyChart } from '@/features/analytics/DetectionAccuracyChart'
import { DetectionRateTile } from '@/features/analytics/DetectionRateTile'
import { GeographicAttackMapCard } from '@/features/analytics/GeographicAttackMapCard'
import { HackersDetectedTile } from '@/features/analytics/HackersDetectedTile'
import { LiveAttackCounter } from '@/features/analytics/LiveAttackCounter'
import { ThreatRateTile } from '@/features/analytics/ThreatRateTile'
import { ThreatSeverityChart } from '@/features/analytics/ThreatSeverityChart'
import { ThreatTrendsChart } from '@/features/analytics/ThreatTrendsChart'
import { TopTargetedResourcesChart } from '@/features/analytics/TopTargetedResourcesChart'
import { UserThreatCountsPanel } from '@/features/analytics/UserThreatCountsPanel'

// Milestone F7 (Threat Analytics) assembled the first content on this
// page: F7.1's user threat-tier counts, F7.2's trend chart, F7.3's
// severity distribution, and F7.4's live attack counter. Milestone F8
// (Time-Based Analytics) added the shared time-range filter (F8.1, top of
// the page) -- which F7.1-F7.3's tiles now read from too, see each of
// their own comments -- plus five range-scoped metrics (F8.2-F8.5).
// F7.4's live attack counter is unaffected: a rolling "now" window, not a
// historical range, so F8.1 doesn't apply to it. Milestone F12
// (Analytics Visualizations) added the "Visualizations" section below:
// F12.3's detection accuracy chart, F12.5's geographic-map stub, F12.6's
// attack-frequency heatmap, F12.7's top-targeted-resources chart, and
// F12.8's attack-pattern breakdown. F12.1 (threat timeline) and F12.4
// (severity pie chart) needed no new component -- they're exactly
// `ThreatTrendsChart` (F7.2) and `ThreatSeverityChart` (F7.3) above,
// already on this page; F12.2 (attacks-per-day) is the same reasoning
// applied to `ThreatTrendsChart`'s own `attacks` series rather than a
// second, near-duplicate day-bucketed chart -- see tasks.md's F12.1/
// F12.2/F12.4 lines for the full reasoning.
export function Component() {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Threat Analytics</h1>
        <TimeRangeFilter />
      </div>
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <HackersDetectedTile />
        <AttacksInRangeTile />
        <ThreatRateTile />
        <DetectionRateTile />
        <AvgAnomaliesPerHourTile />
      </div>

      <h2 className="text-lg font-semibold">Visualizations</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DetectionAccuracyChart />
        <GeographicAttackMapCard />
        <AttackFrequencyHeatmap />
        <TopTargetedResourcesChart />
        <div className="lg:col-span-2">
          <AttackPatternsChart />
        </div>
      </div>
    </section>
  )
}
