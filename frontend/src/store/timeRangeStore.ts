import { create } from 'zustand'

// F8.1: the shared time-range filter -- tasks.md's own line names this as
// applying "across F7/F9/F11's data hooks", so this lives in `store/`
// (like `authStore`/`liveStreamStore`) rather than colocated with F7's
// `features/analytics/`, ready for F9/F11 to read from once those
// milestones land. `DateRangePicker` (F5.8, `components/date-range-picker.tsx`)
// already implements the last-hour/24h/7d/30d presets plus a custom
// calendar range tasks.md's F8.1 line asks for -- this store just holds
// the currently-selected range in the unix-seconds shape the backend's
// `start`/`end` query params (this milestone's F8.1 backing change) speak,
// so hooks don't each convert `Date` objects themselves.

export interface TimeRange {
  /** unix seconds, inclusive */
  start: number
  end: number
}

const DEFAULT_RANGE_HOURS = 24

function defaultRange(nowMs: number = Date.now()): TimeRange {
  return { start: (nowMs - DEFAULT_RANGE_HOURS * 60 * 60 * 1000) / 1000, end: nowMs / 1000 }
}

interface TimeRangeStore {
  range: TimeRange
  setRange: (range: TimeRange) => void
}

export const useTimeRangeStore = create<TimeRangeStore>((set) => ({
  range: defaultRange(),
  setRange: (range) => set({ range }),
}))
