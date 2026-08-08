// F14 (Company Security Overview). Pure/testable derivations live here,
// same split every earlier milestone's `logic.ts` established -- this
// milestone's tiles are otherwise thin `StatCard` wrappers around F6's
// existing hooks (F14.1/F14.2) or two small new ones (F14.3/F14.4), so
// this file only holds the one piece of real logic: formatting F14.4's
// average response time into something readable.

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 60 * 60

/** `null`/negative input reads as "no data," not "0s" -- a caller should
 * check for that before formatting, this just refuses to lie about it. */
export function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds}s`
  }
  if (seconds < SECONDS_PER_HOUR) {
    const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
    const remainingSeconds = seconds % SECONDS_PER_MINUTE
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }
  const hours = Math.floor(seconds / SECONDS_PER_HOUR)
  const remainingMinutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}
