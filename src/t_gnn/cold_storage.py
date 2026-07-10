"""Cold-storage write path for pruned edges (tasks.md 2.4/6.4, FR2.4, design.md 2.7/§5).

FR2.4 requires severed edges be serialized to cold storage *before* removal
from active memory (no data loss) -- `pruning.py`'s `PruningWatcher` calls
`ColdStorageWriter.write()` and only removes the edge from the Active Graph
Store on success, retrying on the next scan pass otherwise. `Neo4jColdStorageWriter`
itself is synchronous by design (2.4); `BufferedColdStorageWriter` below is
the later hardening pass (6.4) that keeps `PruningWatcher`'s hot path from
stalling when Neo4j itself is slow, without changing `PruningWatcher` at all
-- it's just another `ColdStorageWriter`.

Edges are stored as graph nodes/relationships (design.md 2.7), not flat
rows, to preserve queryability for forensic traversal (Phase 4): each
endpoint becomes/reuses an `Entity` node (merged by id, so repeated traffic
between the same two entities doesn't duplicate node records), connected by
a `PRUNED_EDGE` relationship carrying the edge's full original metadata
(FR4.2) plus its weight and clock reading at prune time.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from dataclasses import dataclass
from typing import Optional, Protocol

from neo4j import GraphDatabase

from t_gnn.schema import Edge

logger = logging.getLogger(__name__)

_WRITE_QUERY = """
MERGE (src:Entity {id: $src})
MERGE (dst:Entity {id: $dst})
CREATE (src)-[r:PRUNED_EDGE {
    edge_id: $edge_id,
    edge_type: $edge_type,
    protocol: $protocol,
    t_e: $t_e,
    w_0: $w_0,
    w_at_prune: $w_at_prune,
    pruned_at: $pruned_at,
    source_system: $source_system,
    raw_event_id: $raw_event_id
}]->(dst)
"""

_INDEX_STATEMENTS = (
    "CREATE INDEX entity_id IF NOT EXISTS FOR (n:Entity) ON (n.id)",
    "CREATE INDEX pruned_edge_ts IF NOT EXISTS FOR ()-[r:PRUNED_EDGE]-() ON (r.pruned_at)",
)


class ColdStorageWriter(Protocol):
    def write(self, edge: Edge, w_at_prune: float, pruned_at: float) -> None: ...


@dataclass
class Neo4jConfig:
    uri: str = "bolt://localhost:7687"
    user: str = "neo4j"
    password: str = "devpassword123"
    database: Optional[str] = None


class Neo4jColdStorageWriter:
    """Writes pruned edges to Neo4j as (Entity)-[:PRUNED_EDGE]->(Entity)."""

    def __init__(self, config: Optional[Neo4jConfig] = None) -> None:
        self.config = config or Neo4jConfig()
        self._driver = GraphDatabase.driver(self.config.uri, auth=(self.config.user, self.config.password))
        with self._driver.session(database=self.config.database) as session:
            for statement in _INDEX_STATEMENTS:
                session.run(statement)

    def write(self, edge: Edge, w_at_prune: float, pruned_at: float) -> None:
        params = {
            "src": edge.src,
            "dst": edge.dst,
            "edge_id": edge.edge_id,
            "edge_type": edge.edge_type,
            "protocol": edge.protocol,
            "t_e": edge.t_e,
            "w_0": edge.w_0,
            "w_at_prune": w_at_prune,
            "pruned_at": pruned_at,
            "source_system": edge.source_system,
            "raw_event_id": edge.raw_event_id,
        }
        with self._driver.session(database=self.config.database) as session:
            session.run(_WRITE_QUERY, params)

    def close(self) -> None:
        self._driver.close()

    def __enter__(self) -> "Neo4jColdStorageWriter":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()


class InMemoryColdStorageWriter:
    """Fake ColdStorageWriter (no Neo4j dependency) for unit-testing the
    Pruning Watcher's write-before-remove behavior in isolation."""

    def __init__(self) -> None:
        self.written: list[tuple[Edge, float, float]] = []

    def write(self, edge: Edge, w_at_prune: float, pruned_at: float) -> None:
        self.written.append((edge, w_at_prune, pruned_at))


class BufferedColdStorageWriter:
    """Non-blocking `ColdStorageWriter` wrapper (tasks.md 6.4, design.md
    §5's "Neo4j write latency spike" mitigation: "Buffer pruned edges in a
    local queue before cold-storage write; never block the prune-from-RAM
    step on cold-storage ack.").

    `write()` only enqueues -- it never talks to the wrapped writer on the
    calling thread, so `PruningWatcher.run_once()` (which calls `write()`
    synchronously per FR2.4's write-before-remove ordering) never stalls on
    a Neo4j slowdown. A background drain thread (`start()`/`stop()`, or
    `drain_once()` for synchronous/testable draining) performs the real
    write against the wrapped writer, retrying on failure up to
    `max_retries` times with `retry_backoff` between attempts before
    logging a data-loss warning and dropping the record.

    This deliberately trades 2.4's stronger "write acknowledged before
    removal" guarantee for pruning throughput under a Neo4j slowdown -- the
    edge is already gone from the Active Graph Store by the time this
    writer's queue actually reaches Neo4j, so a crash between enqueue and
    drain loses that record. That tradeoff, and the residual data-loss risk
    it accepts, is exactly what task 2.4's own docstring deferred to this
    task; callers who need the stronger synchronous guarantee should keep
    using the wrapped writer directly instead of this wrapper.
    """

    def __init__(
        self,
        writer: ColdStorageWriter,
        max_queue_size: int = 10_000,
        max_retries: int = 3,
        retry_backoff: float = 1.0,
    ) -> None:
        self._writer = writer
        self._queue: "queue.Queue[tuple[Edge, float, float, int]]" = queue.Queue(maxsize=max_queue_size)
        self.max_retries = max_retries
        self.retry_backoff = retry_backoff
        self.dropped = 0
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    def write(self, edge: Edge, w_at_prune: float, pruned_at: float) -> None:
        """Enqueues immediately (non-blocking). Raises `queue.Full` only if
        the buffer itself is saturated -- `PruningWatcher` already treats
        any exception from `write()` as "leave the edge active, retry next
        pass" (2.4), so backpressure here degrades the same way a direct
        Neo4j failure already would, rather than needing new handling."""
        self._queue.put_nowait((edge, w_at_prune, pruned_at, 0))

    def qsize(self) -> int:
        return self._queue.qsize()

    def drain_once(self, timeout: Optional[float] = None) -> bool:
        """Process a single queued record, if any, against the wrapped
        writer. Returns False if the queue was empty within `timeout`.
        Synchronous and directly callable in tests, the same run_once()-
        style seam every other watcher in this codebase exposes."""
        try:
            edge, w_at_prune, pruned_at, attempt = self._queue.get(timeout=timeout)
        except queue.Empty:
            return False
        try:
            self._writer.write(edge, w_at_prune, pruned_at)
        except Exception:
            if attempt + 1 >= self.max_retries:
                self.dropped += 1
                logger.error(
                    "cold-storage write permanently failed for edge %s after %d attempt(s) -- record lost",
                    edge.edge_id, attempt + 1, exc_info=True,
                )
            else:
                logger.warning(
                    "buffered cold-storage write failed for edge %s (attempt %d/%d); retrying",
                    edge.edge_id, attempt + 1, self.max_retries, exc_info=True,
                )
                time.sleep(self.retry_backoff)
                self._queue.put_nowait((edge, w_at_prune, pruned_at, attempt + 1))
        return True

    def start(self) -> None:
        """Run the drain loop on a background daemon thread."""
        if self._thread is not None:
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self, timeout: Optional[float] = None) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)
            self._thread = None

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            self.drain_once(timeout=0.1)
