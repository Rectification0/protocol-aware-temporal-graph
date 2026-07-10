"""Audit logging for prune events and motif resets (tasks.md 6.1, NFR5).

NFR5: "All prune and motif-reset events SHALL be logged for tuning and
audit purposes." `pruning.py`'s `PruneEventBus` and `motif_engine.py`'s
`MotifResetBus` already publish exactly the two event types NFR5 cares
about (they exist for FR3.3/FR2.5's own reasons, not for auditability) --
this module's only job is turning them into durable, structured records
rather than transient in-process callbacks.

Records are newline-delimited JSON (one record per line): greppable and
parseable without a schema migration, and no new datastore to run --
consistent with this codebase's general posture of not standing up new
infra beyond what a task actually needs (e.g. `PruneEventBus` itself is
plain in-process pub/sub rather than Kafka).
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Protocol

from t_gnn.motif_engine import MotifResetBus, MotifResetEvent
from t_gnn.pruning import PruneEventBus, PrunedEdgeEvent


class AuditSink(Protocol):
    def write(self, record: dict) -> None: ...


class FileAuditSink:
    """Appends newline-delimited JSON audit records to `path` (NFR5's
    durable log). Opens/closes the file per write rather than holding a
    handle open -- audit records are low-frequency relative to edge
    ingest, so trading a little throughput for never losing a buffered
    line on a crash is the right side of that tradeoff (contrast with
    cold_storage.py's `BufferedColdStorageWriter`, 6.4, which makes the
    opposite tradeoff for its much higher-volume, latency-sensitive path).
    """

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def write(self, record: dict) -> None:
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, sort_keys=True) + "\n")


class InMemoryAuditSink:
    """Recording fake for unit tests that don't need a real file."""

    def __init__(self) -> None:
        self.records: list[dict] = []

    def write(self, record: dict) -> None:
        self.records.append(record)


class AuditLogger:
    """Subscribes to `PruneEventBus`/`MotifResetBus` (if given) and writes
    one structured record per event via `sink`, satisfying NFR5."""

    def __init__(
        self,
        sink: AuditSink,
        prune_bus: PruneEventBus | None = None,
        reset_bus: MotifResetBus | None = None,
    ) -> None:
        self.sink = sink
        if prune_bus is not None:
            prune_bus.subscribe(self.log_prune)
        if reset_bus is not None:
            reset_bus.subscribe(self.log_motif_reset)

    def log_prune(self, event: PrunedEdgeEvent) -> None:
        self.sink.write({
            "type": "prune",
            "edge_id": event.edge.edge_id,
            "src": event.edge.src,
            "dst": event.edge.dst,
            "edge_type": event.edge.edge_type,
            "protocol": event.edge.protocol,
            "w_at_prune": event.w_at_prune,
            "pruned_at": event.pruned_at,
            "logged_at": time.time(),
        })

    def log_motif_reset(self, event: MotifResetEvent) -> None:
        self.sink.write({
            "type": "motif_reset",
            "motif_name": event.motif_name,
            "chain_key": event.chain_key,
            "triggering_edge_id": event.triggering_edge_id,
            "matched_edges": event.matched_edges,
            "reset_at": event.reset_at,
            "logged_at": time.time(),
        })
