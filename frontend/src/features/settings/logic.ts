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

export function formatLambda(lambdaP: number): string {
  return lambdaP.toFixed(4)
}

export function formatWindowSeconds(windowSeconds: number): string {
  return windowSeconds >= 60 ? `${(windowSeconds / 60).toFixed(0)}m` : `${windowSeconds}s`
}

export function formatMotifSteps(stepCount: number): string {
  return `${stepCount} step${stepCount === 1 ? '' : 's'}`
}
