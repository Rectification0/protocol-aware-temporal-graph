"""Pydantic response/request models for the API layer (tasks.md F0.15).

Every field here mirrors an existing dataclass elsewhere in `t_gnn` --
`MetricsSnapshot` (metrics.py), `InferenceResult` (tgnn.py),
`MotifCompletionEvent`/`MotifResetEvent` (motif_engine.py),
`PrunedEdgeRecord` (forensics.py), `ProtocolDecayConfig` (protocol_registry.py),
`MotifDefinition`/`MotifStep` (motifs.py) -- this module only adds the
HTTP-facing (de)serialization shape, never a second definition of what the
data *means*.

`Paginated[T]` and `ErrorResponse` are the two conventions F0.15 asks for,
applied consistently across every list endpoint / error path.
"""

from __future__ import annotations

from typing import Generic, Literal, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class Paginated(BaseModel, Generic[T]):
    items: list[T]
    limit: int
    offset: int
    total: Optional[int] = None


class ErrorResponse(BaseModel):
    error: dict


class MetricsSnapshotOut(BaseModel):
    active_graph_size: int
    prune_rate_per_second: float
    epsilon: Optional[float]
    motif_hit_rate_per_second: float
    motif_reset_rate_per_second: float
    latest_inference_latency_seconds: Optional[float]


class EntityScoreOut(BaseModel):
    entity_id: str
    score: float
    t: float
    trigger: str
    motif_name: Optional[str]


class MotifCompletionOut(BaseModel):
    id: int
    motif_name: str
    chain_key: str
    matched_edges: list[str]
    completed_at: float
    confidence: float


class MotifResetOut(BaseModel):
    id: int
    motif_name: str
    chain_key: str
    triggering_edge_id: str
    matched_edges: list[str]
    reset_at: float


class MotifFeedbackIn(BaseModel):
    motif_name: str
    chain_key: str
    disposition: Literal["true_positive", "false_positive"]
    analyst: Optional[str] = None


class MotifFeedbackOut(BaseModel):
    id: int
    motif_name: str
    chain_key: str
    disposition: str
    noted_at: float
    analyst: Optional[str]


class PrunedEdgeOut(BaseModel):
    edge_id: str
    src: str
    dst: str
    edge_type: str
    protocol: str
    t_e: float
    w_0: float
    w_at_prune: float
    pruned_at: float
    source_system: str
    raw_event_id: Optional[str]


class ProtocolConfigOut(BaseModel):
    protocol: str
    lambda_p: float
    half_life_hours: Optional[float]
    description: Optional[str]


class MotifStepOut(BaseModel):
    key_field: str
    edge_type: list[str]
    protocol: list[str]
    src_type: list[str]
    dst_type: list[str]
    key_resolver: str


class MotifConfigOut(BaseModel):
    name: str
    description: Optional[str]
    window_seconds: float
    steps: list[MotifStepOut]


class AuditRecordOut(BaseModel):
    """Mirrors `audit.py`'s two record shapes (`log_prune`/`log_motif_reset`)
    -- fields not applicable to a given `type` are `None` rather than the
    endpoint returning two different response shapes."""

    type: Literal["prune", "motif_reset"]
    logged_at: float
    # prune fields
    edge_id: Optional[str] = None
    src: Optional[str] = None
    dst: Optional[str] = None
    edge_type: Optional[str] = None
    protocol: Optional[str] = None
    w_at_prune: Optional[float] = None
    pruned_at: Optional[float] = None
    # motif_reset fields
    motif_name: Optional[str] = None
    chain_key: Optional[str] = None
    triggering_edge_id: Optional[str] = None
    matched_edges: Optional[list[str]] = None
    reset_at: Optional[float] = None


class HealthOut(BaseModel):
    status: Literal["ok", "degraded"]
    postgres: bool
    neo4j: bool
    redis: bool
    last_metrics_snapshot_age_seconds: Optional[float]


class DetectionMetricsOut(BaseModel):
    """Mirrors `pilot.py`'s `DetectionMetrics` field-for-field."""

    true_positives: int
    false_positives: int
    false_negatives: int
    precision: Optional[float]
    recall: Optional[float]


class PilotReportOut(BaseModel):
    """Mirrors `pilot.py`'s `PilotReport` (`{"anomaly": ..., "motif": ...}`,
    the exact shape its CLI's `--output` JSON dump writes) plus
    `evaluated_at` -- the report file's own mtime, since neither
    `PilotReport` nor its JSON dump carries a timestamp of its own
    (tasks.md F8.4: this must be labeled "as of last pilot evaluation,"
    not live, and a caller needs *some* timestamp to render that label)."""

    anomaly: DetectionMetricsOut
    motif: DetectionMetricsOut
    evaluated_at: float


class AlertAckIn(BaseModel):
    detection_type: str
    detection_ref: str
    analyst: Optional[str] = None
    notes: Optional[str] = None


class AlertAckOut(BaseModel):
    detection_type: str
    detection_ref: str
    acknowledged_by: Optional[str]
    acknowledged_at: float
    notes: Optional[str]
