import { apiRequest } from '@/api/client'
import type {
  AlertAckIn,
  AlertAckOut,
  AuditRecordOut,
  AuditRecordType,
  EntityScoreOut,
  HealthOut,
  MotifCompletionOut,
  MotifConfigOut,
  MotifFeedbackIn,
  MotifFeedbackOut,
  MotifResetOut,
  Paginated,
  PilotReportOut,
  ProtocolConfigOut,
  PrunedEdgeOut,
} from '@/types/api'

// F4.1: one typed function per F0 endpoint. Grouped by router to mirror
// `src/t_gnn/api/routers/` 1:1 -- a new backend route gets a new function
// here, not a change to an existing one's shape.

export interface PageParams {
  limit?: number
  offset?: number
  signal?: AbortSignal
}

// F8.1: unix-seconds bounds accepted by `/api/scores/entities` and
// `/api/motifs/completions` -- optional on both endpoint functions below,
// so every existing caller (F6/F7's unfiltered tiles) is unaffected.
export interface TimeRangeParams {
  start?: number
  end?: number
}

export function getMetricsSnapshot(signal?: AbortSignal) {
  return apiRequest<import('@/types/api').MetricsSnapshotOut>('/api/metrics/snapshot', { signal })
}

export function listEntityScores({
  limit,
  offset,
  start,
  end,
  signal,
}: PageParams & TimeRangeParams = {}) {
  return apiRequest<Paginated<EntityScoreOut>>('/api/scores/entities', {
    query: { limit, offset, start, end },
    signal,
  })
}

// F10.3: a point lookup, added for the User Investigation page's risk-
// score display -- a specific entity may not appear at all in
// `listEntityScores`'s |score|-ranked, `limit`-bounded page.
export function getEntityScore(entityId: string, signal?: AbortSignal) {
  return apiRequest<EntityScoreOut>(`/api/scores/entities/${encodeURIComponent(entityId)}`, {
    signal,
  })
}

export function listMotifCompletions({
  limit,
  offset,
  motifName,
  chainKey,
  start,
  end,
  signal,
}: PageParams & TimeRangeParams & { motifName?: string; chainKey?: string } = {}) {
  return apiRequest<Paginated<MotifCompletionOut>>('/api/motifs/completions', {
    query: { limit, offset, motif_name: motifName, chain_key: chainKey, start, end },
    signal,
  })
}

export function getPilotReport(signal?: AbortSignal) {
  return apiRequest<PilotReportOut>('/api/pilot/latest-report', { signal })
}

export function listMotifResets({ limit, offset, signal }: PageParams = {}) {
  return apiRequest<Paginated<MotifResetOut>>('/api/motifs/resets', {
    query: { limit, offset },
    signal,
  })
}

export function listMotifFeedback({ limit, offset, signal }: PageParams = {}) {
  return apiRequest<Paginated<MotifFeedbackOut>>('/api/motifs/feedback', {
    query: { limit, offset },
    signal,
  })
}

export function submitMotifFeedback(body: MotifFeedbackIn) {
  return apiRequest<MotifFeedbackOut>('/api/motifs/feedback', { method: 'POST', body })
}

export function getEntityForensics(
  entityId: string,
  start: number,
  end: number,
  signal?: AbortSignal,
) {
  return apiRequest<PrunedEdgeOut[]>(`/api/forensics/entity/${encodeURIComponent(entityId)}`, {
    query: { start, end },
    signal,
  })
}

export function getPrunedEdge(edgeId: string, signal?: AbortSignal) {
  return apiRequest<PrunedEdgeOut>(`/api/forensics/edge/${encodeURIComponent(edgeId)}`, { signal })
}

export function listProtocolConfig(signal?: AbortSignal) {
  return apiRequest<ProtocolConfigOut[]>('/api/config/protocols', { signal })
}

export function listMotifConfig(signal?: AbortSignal) {
  return apiRequest<MotifConfigOut[]>('/api/config/motifs', { signal })
}

// F11.1/F11.2: `until` mirrors F8.1's `start`/`end` bound naming (adapted
// to this endpoint's existing `since` vocabulary rather than renaming it);
// `entity` is an exact match against a prune record's src/dst or a
// motif-reset's chain_key; `q` is a freetext substring match across every
// record field (`audit.py`'s `_record_matches_query`).
export function listAuditLog({
  limit,
  offset,
  since,
  until,
  type,
  entity,
  q,
  signal,
}: PageParams & {
  since?: number
  until?: number
  type?: AuditRecordType
  entity?: string
  q?: string
} = {}) {
  return apiRequest<Paginated<AuditRecordOut>>('/api/audit/log', {
    query: { limit, offset, since, until, type, entity, q },
    signal,
  })
}

// F10.1: distinct known entity ids -- `type` is a node-id type prefix
// (e.g. "User" matches "User:*"), for the User Investigation user list.
export function listEntities({ type, limit, offset, signal }: PageParams & { type?: string } = {}) {
  return apiRequest<Paginated<string>>('/api/entities', {
    query: { type, limit, offset },
    signal,
  })
}

export function getHealth(signal?: AbortSignal) {
  return apiRequest<HealthOut>('/api/health', { signal })
}

export function acknowledgeAlert(body: AlertAckIn) {
  return apiRequest<AlertAckOut>('/api/alerts/ack', { method: 'POST', body })
}
