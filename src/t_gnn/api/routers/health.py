"""Backing for F6.4 (system health tile) / F6.5 (active monitoring status).

"Health" here means "are this service's real dependencies reachable, and
how stale is the pipeline's last reported metrics snapshot" -- there is no
separate liveness signal the pipeline process (`scripts/run_pipeline.py`)
publishes beyond writing to Postgres/Neo4j/Redis, so that's what this
endpoint actually checks.
"""

from __future__ import annotations

from fastapi import APIRouter

from t_gnn.api import deps
from t_gnn.api.schemas import HealthOut

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthOut)
def health() -> HealthOut:
    # Calls through the `deps` module object (not a `from ... import name`
    # copy) so tests can `monkeypatch.setattr(deps, "postgres_reachable",
    # ...)` and have it actually take effect here.
    postgres_ok = deps.postgres_reachable()
    neo4j_ok = deps._neo4j_reachable(deps.neo4j_config())
    redis_ok = deps.redis_reachable()
    age = deps.seconds_since_last_metrics_snapshot() if postgres_ok else None
    status = "ok" if (postgres_ok and neo4j_ok and redis_ok) else "degraded"
    return HealthOut(
        status=status, postgres=postgres_ok, neo4j=neo4j_ok, redis=redis_ok,
        last_metrics_snapshot_age_seconds=age,
    )
