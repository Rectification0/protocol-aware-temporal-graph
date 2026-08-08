"""Postgres-backed persistence for the frontend API layer's own state.

Architecture decision (tasks.md Milestone F0, decided with the developer
2026-07-30): the API service is a **decoupled, stateless reader** -- it
never shares a process with whatever is actually running the detection
pipeline (`scripts/run_pipeline.py` or a successor). That means the
in-process pub/sub state `metrics.py`'s `MetricsCollector`,
`motif_engine.py`'s `MotifAlertBus`/`MotifResetBus`, `tgnn.py`'s
`InferenceResultBus`, and `feedback.py`'s `MotifFeedbackBus` all hold is
invisible to the API process unless something durable bridges the two.
This module is that bridge, reusing the already-provisioned local Postgres
instance (`t_gnn/db.py`, `t_gnn_dev`) per CLAUDE.md's "Local dev database"
guidance to use it for persistence needs that don't map to Neo4j's (cold
storage) or Redis's (motif working-state cache) existing roles -- API
read-serving bookkeeping is exactly such a need, so this is the first task
that actually creates tables in that database.

`create_api_tables()` is the idempotent DDL entrypoint (called by
`scripts/init_postgres.py`, the same way task 2.4/3.3 stood up their own
stores' schemas the first time they were needed). `ApiStateWriter`
auto-subscribes to the existing buses on construction -- the same
auto-subscribe convention `audit.py`'s `AuditLogger` and `metrics.py`'s
`MetricsCollector` already use -- and persists one row per event.
`ApiStateReader` is the read side the FastAPI service (`t_gnn/api/`)
queries; it has no dependency on any bus or live engine object, only on
Postgres, which is what makes it safe to run in a wholly separate process.

Real auth (tasks.md F0.11) is deliberately deferred -- the developer chose
to keep the frontend's mock-auth bypass for this first pass. `users` is
still created now (not left for later) so `motif_feedback`/
`alert_acknowledgements` have a real foreign key to attribute a disposition/
ack to once real login exists, rather than a schema migration later.
"""

from __future__ import annotations

import json
import logging
import time
from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Callable, Optional

import psycopg2

from t_gnn.metrics import MetricsSnapshot
from t_gnn.motif_engine import (
    MotifAlertBus,
    MotifCompletionEvent,
    MotifResetBus,
    MotifResetEvent,
)
from t_gnn.feedback import MotifFeedbackBus, MotifFeedbackEvent
from t_gnn.tgnn import InferenceResult, InferenceResultBus

logger = logging.getLogger(__name__)

ConnectionFactory = Callable[[], AbstractContextManager]

_DDL_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT,
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'analyst',
        created_at DOUBLE PRECISION NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS metrics_snapshots (
        id SERIAL PRIMARY KEY,
        captured_at DOUBLE PRECISION NOT NULL,
        active_graph_size INTEGER NOT NULL,
        prune_rate_per_second DOUBLE PRECISION NOT NULL,
        epsilon DOUBLE PRECISION,
        motif_hit_rate_per_second DOUBLE PRECISION NOT NULL,
        motif_reset_rate_per_second DOUBLE PRECISION NOT NULL,
        latest_inference_latency_seconds DOUBLE PRECISION
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_metrics_snapshots_captured_at ON metrics_snapshots (captured_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS entity_scores (
        entity_id TEXT PRIMARY KEY,
        score DOUBLE PRECISION NOT NULL,
        t DOUBLE PRECISION NOT NULL,
        trigger TEXT NOT NULL,
        motif_name TEXT,
        updated_at DOUBLE PRECISION NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS motif_completions (
        id SERIAL PRIMARY KEY,
        motif_name TEXT NOT NULL,
        chain_key TEXT NOT NULL,
        matched_edges JSONB NOT NULL,
        completed_at DOUBLE PRECISION NOT NULL,
        confidence DOUBLE PRECISION NOT NULL DEFAULT 1.0
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_motif_completions_completed_at ON motif_completions (completed_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS motif_resets (
        id SERIAL PRIMARY KEY,
        motif_name TEXT NOT NULL,
        chain_key TEXT NOT NULL,
        triggering_edge_id TEXT NOT NULL,
        matched_edges JSONB NOT NULL,
        reset_at DOUBLE PRECISION NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_motif_resets_reset_at ON motif_resets (reset_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS motif_feedback (
        id SERIAL PRIMARY KEY,
        motif_name TEXT NOT NULL,
        chain_key TEXT NOT NULL,
        disposition TEXT NOT NULL,
        noted_at DOUBLE PRECISION NOT NULL,
        analyst_id INTEGER REFERENCES users(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS alert_acknowledgements (
        id SERIAL PRIMARY KEY,
        detection_type TEXT NOT NULL,
        detection_ref TEXT NOT NULL,
        acknowledged_by INTEGER REFERENCES users(id),
        acknowledged_at DOUBLE PRECISION NOT NULL,
        notes TEXT
    )
    """,
)


def create_api_tables(conn: "psycopg2.extensions.connection") -> None:
    """Idempotent DDL for every table the API layer owns. Safe to call on
    every process start (mirrors `Neo4jColdStorageWriter`'s `CREATE INDEX
    IF NOT EXISTS` calls on construction)."""
    with conn.cursor() as cur:
        for statement in _DDL_STATEMENTS:
            cur.execute(statement)
    conn.commit()


@dataclass(frozen=True)
class MotifCompletionRecord:
    id: int
    motif_name: str
    chain_key: str
    matched_edges: list
    completed_at: float
    confidence: float


@dataclass(frozen=True)
class MotifResetRecord:
    id: int
    motif_name: str
    chain_key: str
    triggering_edge_id: str
    matched_edges: list
    reset_at: float


@dataclass(frozen=True)
class MotifFeedbackRecord:
    id: int
    motif_name: str
    chain_key: str
    disposition: str
    noted_at: float
    analyst: Optional[str]


@dataclass(frozen=True)
class EntityScoreUpdate:
    """`InferenceResult` plus the `entity_scores.updated_at` upsert
    timestamp -- F0.10's SSE poll needs `updated_at` to advance its cursor,
    but `InferenceResult` itself (tgnn.py) has no such field, since that
    dataclass is shared with the non-API-layer pipeline code that has no
    concept of "when Postgres last upserted this row"."""

    result: InferenceResult
    updated_at: float


@dataclass(frozen=True)
class AlertAcknowledgementRecord:
    id: int
    detection_type: str
    detection_ref: str
    acknowledged_by: Optional[str]
    acknowledged_at: float
    notes: Optional[str]


class ApiStateWriter:
    """Auto-subscribes to the live pipeline's buses (when given) and
    persists one row per event, so a separate API process can read this
    history without sharing memory with the pipeline process.

    Every write goes through `_execute`, which catches `psycopg2.Error` and
    flips `self.available` to `False` (logged once, not per event) instead
    of propagating -- the same graceful-degradation posture
    `motif_engine.py`'s Redis-outage handling (tasks.md 6.3) takes, so a
    Postgres outage disables API-history persistence without crashing the
    pipeline process itself. The next successful write flips it back.
    """

    def __init__(
        self,
        connection_factory: ConnectionFactory,
        alert_bus: Optional[MotifAlertBus] = None,
        reset_bus: Optional[MotifResetBus] = None,
        result_bus: Optional[InferenceResultBus] = None,
        feedback_bus: Optional[MotifFeedbackBus] = None,
    ) -> None:
        self._connection_factory = connection_factory
        self.available = True
        self._warned = False

        if alert_bus is not None:
            alert_bus.subscribe(self.record_motif_completion)
        if reset_bus is not None:
            reset_bus.subscribe(self.record_motif_reset)
        if result_bus is not None:
            result_bus.subscribe(self.record_entity_score)
        if feedback_bus is not None:
            feedback_bus.subscribe(self.record_motif_feedback)

    def _execute(self, fn: Callable[["psycopg2.extensions.connection"], None]) -> None:
        try:
            with self._connection_factory() as conn:
                fn(conn)
                conn.commit()
            if not self.available:
                logger.info("ApiStateWriter: Postgres reachable again, resuming persistence.")
            self.available = True
            self._warned = False
        except psycopg2.Error as exc:
            self.available = False
            if not self._warned:
                logger.warning("ApiStateWriter: Postgres unavailable (%s); API history persistence disabled.", exc)
                self._warned = True

    def get_or_create_user(self, username: str) -> Optional[int]:
        """Returns the user's id, inserting a placeholder row (no
        password -- real auth is F0.11, still deferred) if this is the
        first time this username has been seen. `None` on a Postgres
        outage."""
        user_id: list[Optional[int]] = [None]

        def _run(conn: "psycopg2.extensions.connection") -> None:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM users WHERE username = %s", (username,))
                row = cur.fetchone()
                if row is not None:
                    user_id[0] = row[0]
                    return
                cur.execute(
                    "INSERT INTO users (username, created_at) VALUES (%s, %s) RETURNING id",
                    (username, time.time()),
                )
                user_id[0] = cur.fetchone()[0]

        self._execute(_run)
        return user_id[0]

    def record_metrics_snapshot(self, snapshot: MetricsSnapshot, t: float) -> None:
        """Called explicitly alongside `MetricsCollector.snapshot()`
        (`scripts/run_pipeline.py`'s `_run_metrics_pass`), the same
        "caller invokes explicitly" pattern `observe_pruning_pass()`/
        `observe_inference_pass()` already use -- there's no bus for
        snapshots themselves."""
        def _run(conn: "psycopg2.extensions.connection") -> None:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO metrics_snapshots
                        (captured_at, active_graph_size, prune_rate_per_second, epsilon,
                         motif_hit_rate_per_second, motif_reset_rate_per_second,
                         latest_inference_latency_seconds)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        t, snapshot.active_graph_size, snapshot.prune_rate_per_second, snapshot.epsilon,
                        snapshot.motif_hit_rate_per_second, snapshot.motif_reset_rate_per_second,
                        snapshot.latest_inference_latency_seconds,
                    ),
                )

        self._execute(_run)

    def record_entity_score(self, result: InferenceResult) -> None:
        """Subscribed to `InferenceResultBus` (`tgnn.py`) -- upserts each
        entity's *latest* score rather than keeping every historical
        inference pass, since F0.3/F9's consumers only need "what is this
        entity's current score," not a full history."""
        def _run(conn: "psycopg2.extensions.connection") -> None:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO entity_scores (entity_id, score, t, trigger, motif_name, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (entity_id) DO UPDATE SET
                        score = EXCLUDED.score, t = EXCLUDED.t, trigger = EXCLUDED.trigger,
                        motif_name = EXCLUDED.motif_name, updated_at = EXCLUDED.updated_at
                    """,
                    (result.entity_id, result.score, result.t, result.trigger, result.motif_name, time.time()),
                )

        self._execute(_run)

    def record_motif_completion(self, event: MotifCompletionEvent) -> None:
        """Subscribed to `MotifAlertBus` (`motif_engine.py`)."""
        def _run(conn: "psycopg2.extensions.connection") -> None:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO motif_completions (motif_name, chain_key, matched_edges, completed_at, confidence)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (event.motif_name, event.chain_key, json.dumps(event.matched_edges), event.completed_at, event.confidence),
                )

        self._execute(_run)

    def record_motif_reset(self, event: MotifResetEvent) -> None:
        """Subscribed to `MotifResetBus` (`motif_engine.py`)."""
        def _run(conn: "psycopg2.extensions.connection") -> None:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO motif_resets (motif_name, chain_key, triggering_edge_id, matched_edges, reset_at)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (event.motif_name, event.chain_key, event.triggering_edge_id, json.dumps(event.matched_edges), event.reset_at),
                )

        self._execute(_run)

    def record_motif_feedback(self, event: MotifFeedbackEvent) -> None:
        """Subscribed to `MotifFeedbackBus` (`feedback.py`, Backlog B.6) --
        this is what makes an analyst's true/false-positive disposition
        (F9.5) durable across API-process restarts, which the pre-existing
        in-memory-only `MotifPriorityTracker` never was."""
        analyst_id = self.get_or_create_user(event.analyst) if event.analyst else None

        def _run(conn: "psycopg2.extensions.connection") -> None:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO motif_feedback (motif_name, chain_key, disposition, noted_at, analyst_id)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (event.motif_name, event.chain_key, event.disposition, event.noted_at, analyst_id),
                )

        self._execute(_run)

    def record_alert_acknowledgement(
        self, detection_type: str, detection_ref: str, analyst: Optional[str], notes: Optional[str], t: float,
    ) -> None:
        """Called directly by the F13.6 acknowledge-alert API endpoint
        (there is no bus for this -- it originates from the API layer
        itself, not the pipeline)."""
        analyst_id = self.get_or_create_user(analyst) if analyst else None

        def _run(conn: "psycopg2.extensions.connection") -> None:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO alert_acknowledgements (detection_type, detection_ref, acknowledged_by, acknowledged_at, notes)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (detection_type, detection_ref, analyst_id, t, notes),
                )

        self._execute(_run)


def _time_range_conditions(column: str, start: Optional[float], end: Optional[float]) -> tuple[list[str], list]:
    """tasks.md F8.1's shared `start`/`end` (unix seconds, inclusive)
    filter -- one helper so `list_entity_scores`/`list_motif_completions`
    and their `count_*` companions build the identical `WHERE` fragment
    rather than each hand-rolling it."""
    clauses: list[str] = []
    params: list = []
    if start is not None:
        clauses.append(f"{column} >= %s")
        params.append(start)
    if end is not None:
        clauses.append(f"{column} <= %s")
        params.append(end)
    return clauses, params


def _time_range_clause(column: str, start: Optional[float], end: Optional[float]) -> tuple[str, list]:
    """Same as `_time_range_conditions`, pre-joined with a leading
    `WHERE` for callers with no other condition to `AND` it against."""
    clauses, params = _time_range_conditions(column, start, end)
    return (" WHERE " + " AND ".join(clauses) if clauses else ""), params


class ApiStateReader:
    """The read side the FastAPI service (`t_gnn/api/`) queries -- no
    dependency on any bus or live engine object, only on Postgres, which is
    what makes it safe to run in a process wholly separate from whatever is
    running the pipeline."""

    def __init__(self, connection_factory: ConnectionFactory) -> None:
        self._connection_factory = connection_factory

    def latest_metrics_snapshot(self) -> Optional[MetricsSnapshot]:
        with self._connection_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT active_graph_size, prune_rate_per_second, epsilon,
                           motif_hit_rate_per_second, motif_reset_rate_per_second,
                           latest_inference_latency_seconds
                    FROM metrics_snapshots ORDER BY captured_at DESC LIMIT 1
                    """
                )
                row = cur.fetchone()
        if row is None:
            return None
        return MetricsSnapshot(
            active_graph_size=row[0], prune_rate_per_second=row[1], epsilon=row[2],
            motif_hit_rate_per_second=row[3], motif_reset_rate_per_second=row[4],
            latest_inference_latency_seconds=row[5],
        )

    def list_entity_scores(
        self,
        limit: int = 50,
        offset: int = 0,
        start: Optional[float] = None,
        end: Optional[float] = None,
    ) -> list[InferenceResult]:
        """Sorted by `abs(score)` descending (F0.3's "sortable by
        abs(score)"), the same ordering `score_entities.py`'s CLI prints.
        `start`/`end` (tasks.md F8.1, inclusive) filter on `t` -- since
        `entity_scores` is upserted/latest-value-only (this file's own
        module docstring), this selects entities whose *latest* score
        happens to fall in the window, not a true historical count."""
        query = "SELECT entity_id, score, t, trigger, motif_name FROM entity_scores"
        clause, params = _time_range_clause("t", start, end)
        query += clause + " ORDER BY abs(score) DESC LIMIT %s OFFSET %s"
        params = params + [limit, offset]
        with self._connection_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(query, tuple(params))
                rows = cur.fetchall()
        return [InferenceResult(entity_id=r[0], score=r[1], t=r[2], trigger=r[3], motif_name=r[4]) for r in rows]

    def count_entity_scores(self, start: Optional[float] = None, end: Optional[float] = None) -> int:
        """Companion to `list_entity_scores` -- an exact `COUNT(*)` for the
        same `start`/`end` window (tasks.md F8.5's "average anomalies per
        hour" needs the true count, not just a `limit`-bounded page)."""
        clause, params = _time_range_clause("t", start, end)
        with self._connection_factory() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT count(*) FROM entity_scores" + clause, tuple(params))
                return cur.fetchone()[0]

    def get_entity_score(self, entity_id: str) -> Optional[InferenceResult]:
        """tasks.md F10.3: a single entity's latest recorded score --
        `entity_id` is `entity_scores`' primary key (upserted, latest-value
        -only per this file's module docstring), so this is a point
        lookup, not a search within `list_entity_scores`'s |score|-ranked,
        `limit`-bounded page (which could miss a low-magnitude entity
        entirely). `None` if this entity has never been scored."""
        with self._connection_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT entity_id, score, t, trigger, motif_name FROM entity_scores WHERE entity_id = %s",
                    (entity_id,),
                )
                row = cur.fetchone()
        if row is None:
            return None
        return InferenceResult(entity_id=row[0], score=row[1], t=row[2], trigger=row[3], motif_name=row[4])

    def list_motif_completions(
        self,
        limit: int = 50,
        offset: int = 0,
        motif_name: Optional[str] = None,
        chain_key: Optional[str] = None,
        start: Optional[float] = None,
        end: Optional[float] = None,
    ) -> list[MotifCompletionRecord]:
        """`start`/`end` (tasks.md F8.1, inclusive) filter on
        `completed_at` -- unlike `entity_scores`, `motif_completions` is an
        append-only log (every completion is inserted, never upserted), so
        this count/window is exact, not a latest-value proxy. `chain_key`
        (tasks.md F10.5) is the entity a completion pivots on -- filtering
        by it is how the User Investigation page finds every motif this
        entity has ever triggered, not just whatever's in a recent sample."""
        query = "SELECT id, motif_name, chain_key, matched_edges, completed_at, confidence FROM motif_completions"
        clauses, params = _time_range_conditions("completed_at", start, end)
        if motif_name is not None:
            clauses.append("motif_name = %s")
            params.append(motif_name)
        if chain_key is not None:
            clauses.append("chain_key = %s")
            params.append(chain_key)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY completed_at DESC LIMIT %s OFFSET %s"
        params = params + [limit, offset]
        with self._connection_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(query, tuple(params))
                rows = cur.fetchall()
        return [
            MotifCompletionRecord(id=r[0], motif_name=r[1], chain_key=r[2], matched_edges=r[3], completed_at=r[4], confidence=r[5])
            for r in rows
        ]

    def count_motif_completions(
        self,
        motif_name: Optional[str] = None,
        chain_key: Optional[str] = None,
        start: Optional[float] = None,
        end: Optional[float] = None,
    ) -> int:
        """Companion to `list_motif_completions` -- an exact `COUNT(*)`
        for tasks.md F8.3's "number of attacks" / F8.4's "threat rate"."""
        clauses, params = _time_range_conditions("completed_at", start, end)
        if motif_name is not None:
            clauses.append("motif_name = %s")
            params.append(motif_name)
        if chain_key is not None:
            clauses.append("chain_key = %s")
            params.append(chain_key)
        query = "SELECT count(*) FROM motif_completions"
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        with self._connection_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(query, tuple(params))
                return cur.fetchone()[0]

    def list_motif_resets(self, limit: int = 50, offset: int = 0) -> list[MotifResetRecord]:
        with self._connection_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, motif_name, chain_key, triggering_edge_id, matched_edges, reset_at
                    FROM motif_resets ORDER BY reset_at DESC LIMIT %s OFFSET %s
                    """,
                    (limit, offset),
                )
                rows = cur.fetchall()
        return [
            MotifResetRecord(id=r[0], motif_name=r[1], chain_key=r[2], triggering_edge_id=r[3], matched_edges=r[4], reset_at=r[5])
            for r in rows
        ]

    def list_motif_feedback(self, limit: int = 50, offset: int = 0) -> list[MotifFeedbackRecord]:
        with self._connection_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT f.id, f.motif_name, f.chain_key, f.disposition, f.noted_at, u.username
                    FROM motif_feedback f LEFT JOIN users u ON u.id = f.analyst_id
                    ORDER BY f.noted_at DESC LIMIT %s OFFSET %s
                    """,
                    (limit, offset),
                )
                rows = cur.fetchall()
        return [
            MotifFeedbackRecord(id=r[0], motif_name=r[1], chain_key=r[2], disposition=r[3], noted_at=r[4], analyst=r[5])
            for r in rows
        ]

    def list_motif_completions_since(self, min_id: int, limit: int = 100) -> list[MotifCompletionRecord]:
        """F0.10's SSE poll cursor: rows with `id > min_id`, ascending (so
        a client emits them to the wire in the order they actually
        happened), rather than `list_motif_completions`'s DESC "recent
        page" ordering meant for a one-shot listing request."""
        with self._connection_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, motif_name, chain_key, matched_edges, completed_at, confidence
                    FROM motif_completions WHERE id > %s ORDER BY id ASC LIMIT %s
                    """,
                    (min_id, limit),
                )
                rows = cur.fetchall()
        return [
            MotifCompletionRecord(id=r[0], motif_name=r[1], chain_key=r[2], matched_edges=r[3], completed_at=r[4], confidence=r[5])
            for r in rows
        ]

    def list_motif_resets_since(self, min_id: int, limit: int = 100) -> list[MotifResetRecord]:
        with self._connection_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, motif_name, chain_key, triggering_edge_id, matched_edges, reset_at
                    FROM motif_resets WHERE id > %s ORDER BY id ASC LIMIT %s
                    """,
                    (min_id, limit),
                )
                rows = cur.fetchall()
        return [
            MotifResetRecord(id=r[0], motif_name=r[1], chain_key=r[2], triggering_edge_id=r[3], matched_edges=r[4], reset_at=r[5])
            for r in rows
        ]

    def list_entity_scores_since(self, min_updated_at: float, limit: int = 100) -> list[EntityScoreUpdate]:
        """Cursor is `updated_at` (upsert time), not `t` (the inference
        pass's own timestamp) -- `entity_scores` keeps only the latest row
        per entity (F0.3's design), so `updated_at` is what actually
        advances monotonically as new scores land."""
        with self._connection_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT entity_id, score, t, trigger, motif_name, updated_at FROM entity_scores
                    WHERE updated_at > %s ORDER BY updated_at ASC LIMIT %s
                    """,
                    (min_updated_at, limit),
                )
                rows = cur.fetchall()
        return [
            EntityScoreUpdate(
                result=InferenceResult(entity_id=r[0], score=r[1], t=r[2], trigger=r[3], motif_name=r[4]),
                updated_at=r[5],
            )
            for r in rows
        ]

    def list_alert_acknowledgements(self, limit: int = 50, offset: int = 0) -> list[AlertAcknowledgementRecord]:
        with self._connection_factory() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT a.id, a.detection_type, a.detection_ref, u.username, a.acknowledged_at, a.notes
                    FROM alert_acknowledgements a LEFT JOIN users u ON u.id = a.acknowledged_by
                    ORDER BY a.acknowledged_at DESC LIMIT %s OFFSET %s
                    """,
                    (limit, offset),
                )
                rows = cur.fetchall()
        return [
            AlertAcknowledgementRecord(id=r[0], detection_type=r[1], detection_ref=r[2], acknowledged_by=r[3], acknowledged_at=r[4], notes=r[5])
            for r in rows
        ]
