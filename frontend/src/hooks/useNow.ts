import { useSyncExternalStore } from 'react'

// F16.6: one shared clock for "x ago" labels. Memoized live rows (F13's
// feed/panels) no longer re-render on every unrelated event, which is
// what used to refresh their relative timestamps as a side effect --
// subscribing to this instead keeps them fresh on a fixed cadence. A
// single interval runs only while at least one component is subscribed,
// however many rows there are.

const TICK_MS = 15_000

let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (timer === null) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      for (const l of listeners) l()
    }, TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

/** Current time in ms, re-rendering the caller every 15s. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => now)
}
