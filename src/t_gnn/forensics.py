"""Forensic query API over Neo4j cold storage (tasks.md 4.1/4.2/4.3, FR4, design.md 2.7).

Reuses cold_storage.py's write schema -- `(Entity {id})-[:PRUNED_EDGE {...}]->(Entity {id})`
-- rather than inventing a second one; this module only *reads*. FR4.1's
"design the graph schema" is largely already satisfied by `cold_storage.py`'s
2.4 write path (the relationship carries every field FR4.2 requires, and an
`Entity.id` index already exists) -- what's added here is the second half of
4.1 (indexing by the *original event* timestamp, since design.md 2.7's
example forensic query -- "reconstruct all activity around entity X in the
72 hours before an alert" -- reasons about when the activity happened,
`t_e`, not when it was evicted from the Active Graph Store, `pruned_at`,
which `cold_storage.py` already indexes for operational/audit purposes) plus
a point-lookup index on `edge_id` for cross-referencing a specific edge
(e.g. from a motif-completion alert's `matched_edges`, motif_engine.py).

Genuinely wired up against the real `docker-compose.yml` Neo4j instance, the
same treatment 2.4 gave the write path -- not a stub.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from neo4j import GraphDatabase

from t_gnn.cold_storage import Neo4jConfig

_ADDITIONAL_INDEX_STATEMENTS = (
    "CREATE INDEX pruned_edge_t_e IF NOT EXISTS FOR ()-[r:PRUNED_EDGE]-() ON (r.t_e)",
    "CREATE INDEX pruned_edge_id IF NOT EXISTS FOR ()-[r:PRUNED_EDGE]-() ON (r.edge_id)",
)

_ACTIVITY_QUERY = """
MATCH (entity:Entity {id: $entity_id})-[r:PRUNED_EDGE]-(:Entity)
WHERE r.t_e >= $start AND r.t_e <= $end
RETURN startNode(r).id AS src_id, endNode(r).id AS dst_id, r AS rel
ORDER BY r.t_e ASC
"""

_EDGE_BY_ID_QUERY = """
MATCH (src:Entity)-[r:PRUNED_EDGE {edge_id: $edge_id}]->(dst:Entity)
RETURN src.id AS src_id, dst.id AS dst_id, r AS rel
"""


@dataclass(frozen=True)
class PrunedEdgeRecord:
    """FR4.2: the full original metadata a forensic query returns for one
    pruned edge -- endpoints, protocol, original/prune-time timestamps, and
    weight at both ends of its lifecycle."""

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

    @classmethod
    def _from_neo4j(cls, src_id: str, dst_id: str, rel) -> "PrunedEdgeRecord":
        return cls(
            edge_id=rel["edge_id"],
            src=src_id,
            dst=dst_id,
            edge_type=rel["edge_type"],
            protocol=rel["protocol"],
            t_e=rel["t_e"],
            w_0=rel["w_0"],
            w_at_prune=rel["w_at_prune"],
            pruned_at=rel["pruned_at"],
            source_system=rel["source_system"],
            raw_event_id=rel.get("raw_event_id"),
        )


class Neo4jForensicQueryAPI:
    """FR4.1's forensic query interface, reading the relationship shape
    `Neo4jColdStorageWriter` (cold_storage.py) writes."""

    def __init__(self, config: Optional[Neo4jConfig] = None) -> None:
        self.config = config or Neo4jConfig()
        self._driver = GraphDatabase.driver(self.config.uri, auth=(self.config.user, self.config.password))
        with self._driver.session(database=self.config.database) as session:
            for statement in _ADDITIONAL_INDEX_STATEMENTS:
                session.run(statement)

    def reconstruct_activity(self, entity_id: str, start: float, end: float) -> list[PrunedEdgeRecord]:
        """design.md 2.7's example query: "reconstruct all activity around
        entity X in [start, end]." Returns every pruned edge touching
        `entity_id` (as either endpoint) whose original event time `t_e`
        falls in the window, ordered chronologically."""
        with self._driver.session(database=self.config.database) as session:
            records = session.run(_ACTIVITY_QUERY, entity_id=entity_id, start=start, end=end)
            return [PrunedEdgeRecord._from_neo4j(r["src_id"], r["dst_id"], r["rel"]) for r in records]

    def get_edge(self, edge_id: str) -> Optional[PrunedEdgeRecord]:
        """Direct point lookup by edge id -- e.g. to resolve a motif
        completion alert's `matched_edges` (motif_engine.py) back to their
        full pruned-edge metadata. `None` if the edge was never pruned (or
        is still active)."""
        with self._driver.session(database=self.config.database) as session:
            record = session.run(_EDGE_BY_ID_QUERY, edge_id=edge_id).single()
        if record is None:
            return None
        return PrunedEdgeRecord._from_neo4j(record["src_id"], record["dst_id"], record["rel"])

    def close(self) -> None:
        self._driver.close()

    def __enter__(self) -> "Neo4jForensicQueryAPI":
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()
