import type { ThreatSeverity } from '@/components/severity-badge'
import type { AuditRecordOut, AuditRecordType, MotifResetOut } from '@/types/api'

// F11 (Log Explorer). Pure/testable derivations live here, same split
// every earlier milestone's `logic.ts` established -- `columns.tsx`/
// `LogsPage.tsx` just wire a hook's (and the live stream's) result
// through these and render via F5.4's `DataTable`/F5.14's `SeverityBadge`.

export interface LogRow {
  /** Stable identity for `DataTable`'s `getRowId` -- see `logRowKey`. */
  key: string
  type: AuditRecordType
  timestamp: number
  severity: ThreatSeverity
  summary: string
  /** The prune record's `src`/`dst`, or the motif-reset's `chain_key` --
   * `null` only if a record is missing every one of those fields, which
   * shouldn't happen for a well-formed record but isn't assumed. */
  entity: string | null
  record: AuditRecordOut
  /** F11.7: set for rows sourced from the live stream that haven't yet
   * been folded into a fetched page. */
  isNew: boolean
}

// --- F11.4: severity / "malicious event" highlighting ----------------------
//
// Illustrative thresholds, not calibrated -- same provisional posture
// F6.2/F7.1/F9's own severity thresholds already document, pending a real
// calibrated model (F0.12). A motif reset always floors at "medium": it
// means a partial detection chain was discarded (a possible missed
// detection, not routine housekeeping), so it's never "info"/"low" --
// mirroring F9's own "a structural match is never low-severity" floor for
// motif completions. A prune's severity instead reads off how much weight
// (`w_at_prune`) the edge still carried at eviction time: pruned while
// still highly weighted implies a memory-pressure eviction cutting off
// still-relevant history (design.md's own failure-mode concern), not an
// ordinary fully-decayed edge aging out naturally.

export const PRUNE_SEVERITY_THRESHOLDS = { medium: 0.5, low: 0.2 } as const
export const MOTIF_RESET_SEVERITY: ThreatSeverity = 'medium'

export function classifyPruneSeverity(wAtPrune: number | null | undefined): ThreatSeverity {
  const w = wAtPrune ?? 0
  if (w >= PRUNE_SEVERITY_THRESHOLDS.medium) return 'medium'
  if (w >= PRUNE_SEVERITY_THRESHOLDS.low) return 'low'
  return 'info'
}

export function classifyLogSeverity(record: AuditRecordOut): ThreatSeverity {
  return record.type === 'motif_reset'
    ? MOTIF_RESET_SEVERITY
    : classifyPruneSeverity(record.w_at_prune)
}

// --- row construction -------------------------------------------------------

export function summarizeLogRecord(record: AuditRecordOut): string {
  if (record.type === 'prune') {
    const edgeType = record.edge_type ?? 'edge'
    const protocol = record.protocol ? ` (${record.protocol})` : ''
    return `Pruned ${edgeType}${protocol}: ${record.src ?? '?'} -> ${record.dst ?? '?'}`
  }
  return `Motif reset: ${record.motif_name ?? '?'} (chain ${record.chain_key ?? '?'})`
}

export function logRecordEntity(record: AuditRecordOut): string | null {
  if (record.type === 'prune') return record.src ?? record.dst ?? null
  return record.chain_key ?? null
}

/** Prune records have no numeric id (`audit.py` never assigns one), so a
 * composite of the fields that are actually unique per record is the
 * stable key -- `edge_id` alone can repeat once an edge decays, gets
 * re-observed, and is pruned a second time. */
export function logRowKey(record: AuditRecordOut): string {
  return record.type === 'prune'
    ? `prune:${record.edge_id ?? '?'}:${record.pruned_at ?? record.logged_at}`
    : `motif_reset:${record.chain_key ?? '?'}:${record.reset_at ?? record.logged_at}`
}

export function toLogRow(record: AuditRecordOut, isNew = false): LogRow {
  return {
    key: logRowKey(record),
    type: record.type,
    timestamp: record.logged_at,
    severity: classifyLogSeverity(record),
    summary: summarizeLogRecord(record),
    entity: logRecordEntity(record),
    record,
    isNew,
  }
}

/** F11.7: the stream's `motif_reset` SSE event carries `MotifResetOut`
 * (from `ApiStateReader.list_motif_resets_since`), not the audit log's own
 * `AuditRecordOut` shape (from `FileAuditSink`'s NDJSON) -- the two record
 * the same underlying `MotifResetEvent` through different paths (Postgres
 * vs. the audit file), so this adapts one into the other for display
 * purposes. `logged_at` has no real equivalent on `MotifResetOut`; using
 * `reset_at` is accurate enough for a "just happened" live preview row. */
export function motifResetEventToAuditRecord(reset: MotifResetOut): AuditRecordOut {
  return {
    type: 'motif_reset',
    logged_at: reset.reset_at,
    motif_name: reset.motif_name,
    chain_key: reset.chain_key,
    triggering_edge_id: reset.triggering_edge_id,
    matched_edges: reset.matched_edges,
    reset_at: reset.reset_at,
  }
}

// --- F11.1/F11.2: client-side matching for not-yet-fetched live rows -------
//
// The backend's `q`/`entity` params (`audit.py`) already filter a fetched
// page server-side; these mirror that same logic client-side so a row
// streamed in live (not yet part of any fetched page) still respects the
// currently active search/entity filter before it's shown in the "new
// events" preview.

export function matchesQuery(record: AuditRecordOut, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const fields = [
    record.edge_id,
    record.src,
    record.dst,
    record.edge_type,
    record.protocol,
    record.motif_name,
    record.chain_key,
    record.triggering_edge_id,
    ...(record.matched_edges ?? []),
  ]
  return fields.some((field) => field?.toLowerCase().includes(q))
}

export function matchesEntity(record: AuditRecordOut, entity: string): boolean {
  return record.src === entity || record.dst === entity || record.chain_key === entity
}

/** F11.7: combines every active filter (type/entity/query/time-range) into
 * one check, for deciding whether a record streamed in live belongs in
 * the "new events" preview under the page's *currently applied* filters
 * -- not just unconditionally shown. */
export interface LogFilterCriteria {
  type: AuditRecordType | null
  entity: string | null
  query: string
  start: number
  end: number
}

export function matchesLogFilters(record: AuditRecordOut, criteria: LogFilterCriteria): boolean {
  if (criteria.type !== null && record.type !== criteria.type) return false
  if (criteria.entity !== null && !matchesEntity(record, criteria.entity)) return false
  if (!matchesQuery(record, criteria.query)) return false
  return record.logged_at >= criteria.start && record.logged_at <= criteria.end
}

// --- F11.5: export -----------------------------------------------------------

export function logsToJson(rows: LogRow[]): string {
  return JSON.stringify(
    rows.map((row) => row.record),
    null,
    2,
  )
}

const CSV_COLUMNS: (keyof AuditRecordOut)[] = [
  'type',
  'logged_at',
  'edge_id',
  'src',
  'dst',
  'edge_type',
  'protocol',
  'w_at_prune',
  'pruned_at',
  'motif_name',
  'chain_key',
  'triggering_edge_id',
  'matched_edges',
  'reset_at',
]

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const raw = Array.isArray(value) ? value.join(';') : String(value)
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
}

export function logsToCsv(rows: LogRow[]): string {
  const header = CSV_COLUMNS.join(',')
  const lines = rows.map((row) =>
    CSV_COLUMNS.map((column) => csvEscape(row.record[column])).join(','),
  )
  return [header, ...lines].join('\n')
}
