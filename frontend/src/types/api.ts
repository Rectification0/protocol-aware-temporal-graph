// Hand-written mirror of src/t_gnn/api/schemas.py (tasks.md F4.1). Codegen
// from F0.15's OpenAPI schema was considered and deferred -- this API
// surface is small (9 routers) and changes rarely enough that a generated
// client would add a build-time dependency without buying much over a
// small, explicit, hand-kept-in-sync file. Revisit if the surface grows
// enough that drift becomes a real risk.
//
// Field names/types/optionality here must match schemas.py exactly --
// there is deliberately no second definition of what the data *means*,
// same convention schemas.py itself follows relative to the dataclasses
// it mirrors.

export interface Paginated<T> {
  items: T[]
  limit: number
  offset: number
  total: number | null
}

export interface ApiErrorEnvelope {
  error: {
    code: number
    message: string
  }
}

export interface MetricsSnapshotOut {
  active_graph_size: number
  prune_rate_per_second: number
  epsilon: number | null
  motif_hit_rate_per_second: number
  motif_reset_rate_per_second: number
  latest_inference_latency_seconds: number | null
  total_edges_processed: number
}

export interface EntityScoreOut {
  entity_id: string
  score: number
  t: number
  trigger: string
  motif_name: string | null
}

export interface MotifCompletionOut {
  id: number
  motif_name: string
  chain_key: string
  matched_edges: string[]
  completed_at: number
  confidence: number
}

export interface MotifResetOut {
  id: number
  motif_name: string
  chain_key: string
  triggering_edge_id: string
  matched_edges: string[]
  reset_at: number
}

export type MotifFeedbackDisposition = 'true_positive' | 'false_positive'

export interface MotifFeedbackIn {
  motif_name: string
  chain_key: string
  disposition: MotifFeedbackDisposition
  analyst?: string | null
}

export interface MotifFeedbackOut {
  id: number
  motif_name: string
  chain_key: string
  disposition: string
  noted_at: number
  analyst: string | null
}

export interface PrunedEdgeOut {
  edge_id: string
  src: string
  dst: string
  edge_type: string
  protocol: string
  t_e: number
  w_0: number
  w_at_prune: number
  pruned_at: number
  source_system: string
  raw_event_id: string | null
}

export interface ProtocolConfigOut {
  protocol: string
  lambda_p: number
  half_life_hours: number | null
  description: string | null
}

export interface MotifStepOut {
  key_field: string
  edge_type: string[]
  protocol: string[]
  src_type: string[]
  dst_type: string[]
  key_resolver: string
}

export interface MotifConfigOut {
  name: string
  description: string | null
  window_seconds: number
  steps: MotifStepOut[]
}

export type AuditRecordType = 'prune' | 'motif_reset'

export interface AuditRecordOut {
  type: AuditRecordType
  logged_at: number
  edge_id?: string | null
  src?: string | null
  dst?: string | null
  edge_type?: string | null
  protocol?: string | null
  w_at_prune?: number | null
  pruned_at?: number | null
  motif_name?: string | null
  chain_key?: string | null
  triggering_edge_id?: string | null
  matched_edges?: string[] | null
  reset_at?: number | null
}

export interface HealthOut {
  status: 'ok' | 'degraded'
  postgres: boolean
  neo4j: boolean
  redis: boolean
  last_metrics_snapshot_age_seconds: number | null
}

export interface DetectionMetricsOut {
  true_positives: number
  false_positives: number
  false_negatives: number
  precision: number | null
  recall: number | null
}

export interface PilotReportOut {
  anomaly: DetectionMetricsOut
  motif: DetectionMetricsOut
  evaluated_at: number
}

export interface AlertAckIn {
  detection_type: string
  detection_ref: string
  analyst?: string | null
  notes?: string | null
}

export interface AlertAckOut {
  detection_type: string
  detection_ref: string
  acknowledged_by: string | null
  acknowledged_at: number
  notes: string | null
}

export interface AlertResponseTimeOut {
  average_seconds: number | null
  sample_size: number
}
