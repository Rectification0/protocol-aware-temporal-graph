"""Dependency providers for the FastAPI service (tasks.md F0).

Every provider here either wraps an existing, already-real component
(`ProtocolDecayRegistry`, `MotifRegistry`, `Neo4jForensicQueryAPI`) or
constructs the read/write sides of `api_state.py`'s Postgres bridge. None
of them start or hold a reference to a live pipeline object
(`ActiveGraphStore`, `MotifEngine`, `TGNNInferenceEngine`) -- per the
decoupled-process architecture decision (see `api_state.py`'s module
docstring), this service only ever reads what the pipeline process already
persisted to Neo4j/Redis/Postgres.
"""

from __future__ import annotations

import os
import time
from functools import lru_cache
from typing import Callable, Optional, TypeVar

import psycopg2
import redis
from fastapi import HTTPException

import t_gnn.db  # noqa: F401 -- side effect: loads .env into os.environ
from t_gnn.api_state import ApiStateReader, ApiStateWriter
from t_gnn.cold_storage import Neo4jConfig
from t_gnn.db import get_connection
from t_gnn.forensics import Neo4jForensicQueryAPI
from t_gnn.motifs import MotifRegistry
from t_gnn.protocol_registry import ProtocolDecayRegistry

T = TypeVar("T")


def neo4j_config() -> Neo4jConfig:
    """Mirrors `scripts/run_pipeline.py`'s `_neo4j_config()` -- same
    env-var names, same defaults, so both processes agree on which Neo4j
    instance they're talking to without sharing code."""
    return Neo4jConfig(
        uri=os.environ.get("NEO4J_URI", "bolt://localhost:7687"),
        user=os.environ.get("NEO4J_USER", "neo4j"),
        password=os.environ.get("NEO4J_PASSWORD", "devpassword123"),
    )


def redis_client() -> "redis.Redis":
    """Mirrors `scripts/run_pipeline.py`'s `_redis_client()`. Only used by
    the health-check endpoint today -- the API layer has no direct
    business-logic dependency on Redis (that's `MotifEngine`'s, inside the
    pipeline process)."""
    return redis.Redis(
        host=os.environ.get("REDIS_HOST", "localhost"),
        port=int(os.environ.get("REDIS_PORT", "6379")),
        db=0,
    )


@lru_cache(maxsize=1)
def get_protocol_registry() -> ProtocolDecayRegistry:
    return ProtocolDecayRegistry()


@lru_cache(maxsize=1)
def get_motif_registry() -> MotifRegistry:
    return MotifRegistry()


@lru_cache(maxsize=1)
def get_reader() -> ApiStateReader:
    return ApiStateReader(get_connection)


@lru_cache(maxsize=1)
def get_writer() -> ApiStateWriter:
    """The API-process-local writer -- only used for events that
    *originate* from an API call itself (F9.5 feedback, F13.6 acks), not
    subscribed to any bus (this process has no pipeline buses to subscribe
    to; see `scripts/run_pipeline.py` for the bus-subscribed writer used
    there)."""
    return ApiStateWriter(get_connection)


def require_postgres(fn: Callable[[], T]) -> T:
    """Runs a Postgres-backed read/write and converts a connectivity
    failure into a clean 503 rather than a 500 -- callers still get a
    typed, documented failure mode instead of the API process crashing,
    matching this repo's general graceful-degradation posture (tasks.md
    6.3's Redis-outage handling, `ApiStateWriter.available`'s own
    catch-and-flag behavior for writes)."""
    try:
        return fn()
    except psycopg2.Error as exc:
        raise HTTPException(status_code=503, detail=f"Postgres unavailable: {exc}") from exc


def _neo4j_reachable(config: Neo4jConfig) -> bool:
    from neo4j import GraphDatabase
    from neo4j.exceptions import AuthError, ServiceUnavailable

    try:
        driver = GraphDatabase.driver(config.uri, auth=(config.user, config.password))
        try:
            driver.verify_connectivity()
            return True
        finally:
            driver.close()
    except (ServiceUnavailable, AuthError, OSError):
        return False


_forensics_api: Optional[Neo4jForensicQueryAPI] = None


def get_forensics_api() -> Neo4jForensicQueryAPI:
    """Lazily constructs (and caches) the real `Neo4jForensicQueryAPI` --
    raises a clean 503 instead of crashing the whole service if Neo4j
    isn't reachable, so one unavailable dependency doesn't take down every
    other endpoint."""
    global _forensics_api
    if _forensics_api is None:
        config = neo4j_config()
        if not _neo4j_reachable(config):
            raise HTTPException(status_code=503, detail="Neo4j is not reachable")
        _forensics_api = Neo4jForensicQueryAPI(config)
    return _forensics_api


def postgres_reachable() -> bool:
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        return True
    except psycopg2.Error:
        return False


def redis_reachable() -> bool:
    try:
        redis_client().ping()
        return True
    except redis.RedisError:
        return False


def seconds_since_last_metrics_snapshot() -> Optional[float]:
    try:
        snapshot_age_source = require_postgres(lambda: get_reader().latest_metrics_snapshot())
    except HTTPException:
        return None
    if snapshot_age_source is None:
        return None
    # MetricsSnapshot itself carries no timestamp field (metrics.py's
    # dataclass doesn't need one internally) -- captured_at lives only in
    # the metrics_snapshots table row, so this reads it back directly
    # rather than through ApiStateReader's dataclass-returning method.
    def _read_latest_captured_at() -> Optional[float]:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT captured_at FROM metrics_snapshots ORDER BY captured_at DESC LIMIT 1")
                row = cur.fetchone()
        return row[0] if row else None

    captured_at = require_postgres(_read_latest_captured_at)
    if captured_at is None:
        return None
    return time.time() - captured_at
