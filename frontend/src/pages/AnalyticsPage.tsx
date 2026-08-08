import { TimeRangeFilter } from '@/components/time-range-filter'
import { AttacksInRangeTile } from '@/features/analytics/AttacksInRangeTile'
import { AvgAnomaliesPerHourTile } from '@/features/analytics/AvgAnomaliesPerHourTile'
import { DetectionRateTile } from '@/features/analytics/DetectionRateTile'
import { HackersDetectedTile } from '@/features/analytics/HackersDetectedTile'
import { LiveAttackCounter } from '@/features/analytics/LiveAttackCounter'
import { ThreatRateTile } from '@/features/analytics/ThreatRateTile'
import { ThreatSeverityChart } from '@/features/analytics/ThreatSeverityChart'
import { ThreatTrendsChart } from '@/features/analytics/ThreatTrendsChart'
import { UserThreatCountsPanel } from '@/features/analytics/UserThreatCountsPanel'

// Milestone F7 (Threat Analytics) assembled the first content on this
// page: F7.1's user threat-tier counts, F7.2's trend chart, F7.3's
// severity distribution, and F7.4's live attack counter. Milestone F8
// (Time-Based Analytics) added the shared time-range filter (F8.1, top of
// the page) -- which F7.1-F7.3's tiles now read from too, see each of
// their own comments -- plus five range-scoped metrics (F8.2-F8.5).
// F7.4's live attack counter is unaffected: a rolling "now" window, not a
// historical range, so F8.1 doesn't apply to it. Milestone F12 (the rest
// of this page's charts -- detection accuracy, geographic map, heatmap,
// top-targeted resources, attack-pattern breakdown) builds further onto
// this same page/layout.
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
    </section>
  )
}
