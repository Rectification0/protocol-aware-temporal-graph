// Milestone F15 (Settings). Pure/testable derivations live here, same
// split every earlier milestone's `logic.ts` established.

// --- F15.5: alert-thresholds display ----------------------------------
//
// Read-only rendering helpers over F0.9's `ProtocolConfigOut`/`MotifConfigOut`
// (`config/protocols.yaml`/`config/motifs.yaml`, tasks.md F15.5's own
// scope) -- no write path exists (a real `[BACKEND TODO]`, since today
// those files are hand-edited + `reload()`'d per docs/operational-runbook.md;
// this line's own note descopes editing to a future milestone).

export function formatHalfLife(halfLifeHours: number | null): string {
  if (halfLifeHours === null) return 'n/a'
  return halfLifeHours >= 1 ? `${halfLifeHours.toFixed(1)}h` : `${(halfLifeHours * 60).toFixed(0)}m`
}

// Scientific notation: real λ_p values span ~1e-6 (DNS) to ~2e-4 (RDP), so
// fixed decimals would print several of them as "0.0000".
export function formatLambda(lambdaP: number): string {
  return lambdaP.toExponential(3)
}

// --- Frontend Backlog FB.1: editing thresholds -------------------------
//
// Analysts edit a protocol's *half-life* (hours) -- the human-meaningful
// figure config/protocols.yaml itself documents beside every λ_p -- and the
// form converts; motif windows are edited in minutes. Bounds come from the
// API (`/api/config/capabilities`), so client validation can never drift
// from the server's (config_writer.py) -- it just answers sooner.

const LN2 = Math.log(2)

export function halfLifeHoursToLambda(hours: number): number {
  return LN2 / (hours * 3600)
}

export function lambdaToHalfLifeHours(lambdaP: number): number {
  return LN2 / lambdaP / 3600
}

export interface ThresholdBounds {
  min_lambda_p: number
  max_lambda_p: number
  min_window_seconds: number
  max_window_seconds: number
}

/** `null` if valid, else a message. `raw` is the input field's text. */
export function validateHalfLifeInput(raw: string, bounds: ThresholdBounds): string | null {
  const hours = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(hours)) return 'Enter a number of hours.'
  if (hours <= 0) return 'Half-life must be positive.'
  const lambdaP = halfLifeHoursToLambda(hours)
  const minHours = lambdaToHalfLifeHours(bounds.max_lambda_p)
  const maxHours = lambdaToHalfLifeHours(bounds.min_lambda_p)
  if (lambdaP > bounds.max_lambda_p || lambdaP < bounds.min_lambda_p) {
    return `Half-life must be between ${formatHours(minHours)} and ${formatHours(maxHours)}.`
  }
  return null
}

export function validateWindowMinutesInput(raw: string, bounds: ThresholdBounds): string | null {
  const minutes = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(minutes)) return 'Enter a number of minutes.'
  const seconds = minutes * 60
  if (!Number.isInteger(seconds)) return 'Window must come to a whole number of seconds.'
  if (seconds < bounds.min_window_seconds || seconds > bounds.max_window_seconds) {
    return `Window must be between ${bounds.min_window_seconds / 60} and ${bounds.max_window_seconds / 60} minutes.`
  }
  return null
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} minute${Math.round(hours * 60) === 1 ? '' : 's'}`
  if (hours >= 48) return `${Math.round(hours / 24)} days`
  return `${Number(hours.toPrecision(3))} hours`
}

export function describeConfigChange(change: {
  kind: string
  target: string
  old_value: number
  new_value: number
}): string {
  if (change.kind === 'protocol') {
    return `${change.target} half-life ${formatHalfLife(lambdaToHalfLifeHours(change.old_value))} -> ${formatHalfLife(lambdaToHalfLifeHours(change.new_value))}`
  }
  return `${change.target} window ${formatWindowSeconds(change.old_value)} -> ${formatWindowSeconds(change.new_value)}`
}

export function formatWindowSeconds(windowSeconds: number): string {
  return windowSeconds >= 60 ? `${(windowSeconds / 60).toFixed(0)}m` : `${windowSeconds}s`
}

export function formatMotifSteps(stepCount: number): string {
  return `${stepCount} step${stepCount === 1 ? '' : 's'}`
}
