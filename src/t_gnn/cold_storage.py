"""Cold-storage write path for pruned edges (tasks.md 2.4, FR2.4, design.md 2.7).

FR2.4 requires severed edges be serialized to cold storage *before* removal
from active memory (no data loss) -- `pruning.py`'s `PruningWatcher` calls
`ColdStorageWriter.write()` and only removes the edge from the Active Graph
Store on success, retrying on the next scan pass otherwise. This module's
write is deliberately synchronous: tasks.md splits "implement the write
path" (2.4, here) from "implement buffering for Neo4j write-path so
cold-storage latency never blocks pruning" (6.4) as a later hardening pass,
so a buffered/async writer is out of scope here.

Edges are stored as graph nodes/relationships (design.md 2.7), not flat
rows, to preserve queryability for forensic traversal (Phase 4): each
endpoint becomes/reuses an `Entity` node (merged by id, so repeated traffic
between the same two entities doesn't duplicate node records), connected by
a `PRUNED_EDGE` relationship carrying the edge's full original metadata
(FR4.2) plus its weight and clock reading at prune time.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol

from neo4j import GraphDatabase

from t_gnn.schema import Edge

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
