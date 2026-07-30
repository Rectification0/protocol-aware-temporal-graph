"""F0.2: GET /api/metrics/snapshot -- active graph size, prune rate, ε,
motif hit/reset rate, latest inference latency.

Backing: `src/t_gnn/metrics.py`'s `MetricsCollector.snapshot()` ->
`MetricsSnapshot`. This endpoint does not compute a snapshot itself (that
requires a live `ActiveGraphStore` inside the pipeline process) -- it reads
the most recent snapshot `ApiStateWriter.record_metrics_snapshot()`
persisted, per the decoupled-process architecture decision.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from t_gnn.api.deps import get_reader, require_postgres
from t_gnn.api.schemas import MetricsSnapshotOut
from t_gnn.api_state import ApiStateReader

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


@router.get("/snapshot", response_model=MetricsSnapshotOut)
def read_latest_snapshot(reader: ApiStateReader = Depends(get_reader)) -> MetricsSnapshotOut:
    snapshot = require_postgres(reader.latest_metrics_snapshot)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="no metrics snapshot recorded yet")
    return MetricsSnapshotOut(**snapshot.__dict__)
