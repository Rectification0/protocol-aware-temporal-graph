"""The pipeline's side of the Flink decay/baseline job (Backlog B.1).

`scripts/run_pipeline.py --decay-backend flink` hands decay + baseline to the
running Flink job instead of computing them in-process with
`DecayStreamProcessor`: edges go out to the job's input topic, and what comes
back -- the same `ProcessedEdge` the in-process step returns, plus the job's
timer-driven weight refreshes -- is applied to the live graph here.
"""

from __future__ import annotations

import dataclasses
import json
import urllib.request
from typing import Optional

from t_gnn.flink.kafka_io import (
    DEFAULT_BOOTSTRAP,
    drain,
    ensure_topics,
    make_producer,
    produce_edge,
    publish_lambdas,
    tail_consumer,
)
from t_gnn.flink.logic import DECAYED_TOPIC, JOB_NAME, WEIGHTS_TOPIC, parse_decayed_record
from t_gnn.protocol_registry import ProtocolDecayRegistry
from t_gnn.streaming import ProcessedEdge


def job_running(flink_url: str = "http://localhost:8081") -> bool:
    """Whether the long-running decay/baseline job is RUNNING on the cluster."""
    try:
        with urllib.request.urlopen(f"{flink_url}/jobs/overview", timeout=5) as resp:
            jobs = json.load(resp)["jobs"]
    except Exception:
        return False
    return any(j["name"] == JOB_NAME and j["state"] == "RUNNING" for j in jobs)


def apply_weight_refresh(store, record: dict) -> bool:
    """Update a live edge's `w` from the job's re-evaluation; returns whether it applied.

    An edge the store no longer holds (already pruned) is left alone -- the
    refresh must never resurrect it. Expiry itself isn't acted on: pruning
    stays with `PruningWatcher` and its dynamic epsilon (FR2), which the
    job's fixed `--expire-below` floor doesn't know about.
    """
    edge = store.get(record["edge_id"])
    if edge is None or (edge.w_evaluated_at is not None and edge.w_evaluated_at > record["t"]):
        return False
    store.upsert(dataclasses.replace(edge, w=record["w"], w_evaluated_at=record["t"]))
    return True


class FlinkDecayBridge:
    def __init__(self, bootstrap: str = DEFAULT_BOOTSTRAP) -> None:
        ensure_topics(bootstrap)
        self._producer = make_producer(bootstrap)
        self._consumer = tail_consumer([DECAYED_TOPIC, WEIGHTS_TOPIC], bootstrap)
        self.sent = 0
        self.received = 0

    def publish_lambdas(self, registry: ProtocolDecayRegistry) -> int:
        return publish_lambdas(self._producer, registry)

    def submit(self, edge) -> None:
        produce_edge(self._producer, edge)
        self.sent += 1

    def poll(self, timeout: float = 0.0) -> tuple[list[ProcessedEdge], list[dict]]:
        """Whatever the job has emitted since the last poll."""
        processed, refreshes = [], []
        for topic, value in drain(self._consumer, timeout=timeout):
            if topic == DECAYED_TOPIC:
                edge, deviation = parse_decayed_record(value)
                processed.append(ProcessedEdge(edge=edge, deviation=deviation))
            else:
                refreshes.append(json.loads(value))
        self.received += len(processed)
        return processed, refreshes

    def close(self, flush_timeout: Optional[float] = 10.0) -> None:
        self._producer.flush(flush_timeout)
        self._consumer.close()
