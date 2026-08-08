// F10 (User Investigation). Pure/testable derivations, same split every
// earlier milestone's `logic.ts` established.

// --- F10.4/F10.6: activity timeline / log history ------------------------
//
// No time-range control exists for this page (tasks.md's F10 line never
// asks for one, unlike F8.1's Analytics-page filter) -- rather than guess
// at a recency window with no UI to communicate it, this fetches the
// entity's *entire* pruned-edge history from Neo4j cold storage. A fixed,
// far-future upper bound (not `Date.now()`) keeps this a pure constant
// rather than a render-time clock read (the React Compiler's purity rule
// this codebase already avoids elsewhere, e.g. `features/dashboard/
// ThreatStatusTile.tsx`'s `dataUpdatedAt` anchoring).

export const FULL_HISTORY_WINDOW = { start: 0, end: 9_999_999_999 }

// --- entity id parsing ----------------------------------------------------
//
// Node ids are `"<Type>:<name>"` (schema.py's `Edge.__post_init__`) --
// same shape `features/analytics/logic.ts`'s `isUserEntity()` already
// relies on, generalized here to extract the type for display rather
// than a boolean User-check.

export function entityType(entityId: string): string | null {
  const separatorIndex = entityId.indexOf(':')
  return separatorIndex === -1 ? null : entityId.slice(0, separatorIndex)
}
