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

export function getMetricsSnapshot(signal?: AbortSignal) {
  return apiRequest<import('@/types/api').MetricsSnapshotOut>('/api/metrics/snapshot', { signal })
}

export function listEntityScores({ limit, offset, signal }: PageParams = {}) {
  return apiRequest<Paginated<EntityScoreOut>>('/api/scores/entities', {
    query: { limit, offset },
    signal,
  })
}

export function listMotifCompletions({
  limit,
  offset,
  motifName,
  signal,
}: PageParams & { motifName?: string } = {}) {
  return apiRequest<Paginated<MotifCompletionOut>>('/api/motifs/completions', {
    query: { limit, offset, motif_name: motifName },
    signal,
  })
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

export function listAuditLog({
  limit,
  offset,
  since,
  type,
  signal,
}: PageParams & { since?: number; type?: AuditRecordType } = {}) {
  return apiRequest<Paginated<AuditRecordOut>>('/api/audit/log', {
    query: { limit, offset, since, type },
    signal,
  })
}

export function getHealth(signal?: AbortSignal) {
  return apiRequest<HealthOut>('/api/health', { signal })
}

export function acknowledgeAlert(body: AlertAckIn) {
  return apiRequest<AlertAckOut>('/api/alerts/ack', { method: 'POST', body })
}
