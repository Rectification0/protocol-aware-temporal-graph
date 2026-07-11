"""Load/latency smoke tests for the Active Graph Store + Pruning Watcher
(tasks.md 2.7/2.8).

These are proxy-scale smoke tests, not the literal enterprise-volume (NFR2,
"billions of events/day") or production T-GNN latency (NFR1) validation --
there is no real T-GNN inference engine yet (that's Phase 5); `store.get()`
stands in for "an inference read" here, at a scale meant to demonstrate the
boundedness/non-blocking properties mechanically, not to be a benchmark.
"""

import os
import time

import pytest

from t_gnn.cold_storage import InMemoryColdStorageWriter
from t_gnn.decay import DecayEngine
from t_gnn.graph_store import ActiveGraphStore
from t_gnn.protocol_registry import ProtocolDecayRegistry
from t_gnn.pruning import EpsilonController, PruningWatcher
from t_gnn.schema import Edge

# tasks.md Backlog B.7: NFR1 (sub-ms latency)/NFR2 (billions of events/day)
# have never been validated against real enterprise-scale load -- only real
# infrastructure and real traffic at that scale could actually do that, the
# same acquisition gap task 0.4/7.3 document for the LANL dataset and the
# pilot deployment. `RUN_HEAVY_LOAD_TEST=1` runs a substantially larger
# *local* proxy (still nowhere near "billions/day") than the smoke tests
# above -- opt-in via env var (not run by default) since it's much slower
# than the rest of the suite, mirroring the live-Neo4j/Redis tests'
# skip-rather-than-slow-down-every-run posture.
_RUN_HEAVY_LOAD_TEST = os.environ.get("RUN_HEAVY_LOAD_TEST") == "1"


def _edge(src, dst, t_e, protocol="RDP", w_0=1.0):
    return Edge(src=src, dst=dst, edge_type="Authentication", protocol=protocol, t_e=t_e, w_0=w_0)


def test_active_graph_store_stays_bounded_under_sustained_ingest():
    """2.7: sustained high-volume ingest shouldn't grow the store unbounded --
    each new batch's prune pass should evict edges old enough to have
    decayed below a fixed epsilon, keeping steady-state size ~constant."""
    store = ActiveGraphStore()
    registry = ProtocolDecayRegistry()
    rdp_half_life_seconds = 3600.0  # matches config/protocols.yaml's ~1h RDP half-life
    assert registry.lambda_for("RDP") > 0

    watcher = PruningWatcher(
        store=store,
        decay_engine=DecayEngine(registry=registry),
        epsilon_controller=EpsilonController(epsilon_min=0.5, epsilon_max=0.5),
        cold_storage=InMemoryColdStorageWriter(),
        memory_probe=lambda: None,
    )

    batch_size = 200
    num_batches = 20
    batch_interval = rdp_half_life_seconds + 400.0  # > 1 half-life -> prior batch decays below 0.5 each round

    for batch in range(num_batches):
        now = batch * batch_interval
        for i in range(batch_size):
            idx = batch * batch_size + i
            store.upsert(_edge(src=f"User:u{idx}", dst=f"Machine:m{idx}", t_e=now))
        watcher.run_once(t=now)
        # After each batch's prune pass, only this batch's fresh edges
        # (weight ~1.0, well above epsilon) should remain -- the store
        # doesn't accumulate every edge ever ingested.
        assert len(store) == batch_size

    total_ingested = batch_size * num_batches
    assert total_ingested > batch_size * 10  # sanity: we ingested far more than the steady-state size


def test_reads_stay_fast_while_pruning_runs_concurrently():
    """2.8: proxy for NFR1 -- individual store reads (standing in for a
    T-GNN inference read) shouldn't be stalled by pruning running on its
    background thread (FR2.5's non-blocking requirement)."""
    store = ActiveGraphStore()
    edges = [_edge(src=f"User:u{i}", dst=f"Machine:m{i}", t_e=float(i)) for i in range(2000)]
    for edge in edges:
        store.upsert(edge)

    watcher = PruningWatcher(
        store=store,
        decay_engine=DecayEngine(),
        epsilon_controller=EpsilonController(epsilon_min=0.3, epsilon_max=0.3),
        cold_storage=InMemoryColdStorageWriter(),
        memory_probe=lambda: None,
        poll_interval=0.01,
    )

    watcher.start()
    try:
        latencies = []
        deadline = time.time() + 1.0
        i = 0
        while time.time() < deadline:
            edge_id = edges[i % len(edges)].edge_id
            start = time.perf_counter()
            store.get(edge_id)
            latencies.append(time.perf_counter() - start)
            i += 1
        latencies.sort()
        median = latencies[len(latencies) // 2]
        p99 = latencies[int(len(latencies) * 0.99)]
    finally:
        watcher.stop(timeout=2.0)

    assert median < 0.001  # sub-millisecond proxy read latency
    assert p99 < 0.005


# --- B.7: a substantially larger (still local, still not "enterprise-scale") proxy ---


@pytest.mark.skipif(not _RUN_HEAVY_LOAD_TEST, reason="opt-in: set RUN_HEAVY_LOAD_TEST=1 to run this larger-scale proxy benchmark")
def test_active_graph_store_stays_bounded_under_larger_scale_ingest():
    """25x the edge volume of 2.7's smoke test (125k edges vs. 4k) -- still
    a local proxy, not NFR2's literal "billions of events/day", but a
    meaningfully bigger boundedness check than the default suite runs."""
    store = ActiveGraphStore()
    registry = ProtocolDecayRegistry()
    rdp_half_life_seconds = 3600.0

    watcher = PruningWatcher(
        store=store,
        decay_engine=DecayEngine(registry=registry),
        epsilon_controller=EpsilonController(epsilon_min=0.5, epsilon_max=0.5),
        cold_storage=InMemoryColdStorageWriter(),
        memory_probe=lambda: None,
    )

    batch_size = 5000
    num_batches = 25
    batch_interval = rdp_half_life_seconds + 400.0

    for batch in range(num_batches):
        now = batch * batch_interval
        for i in range(batch_size):
            idx = batch * batch_size + i
            store.upsert(_edge(src=f"User:u{idx}", dst=f"Machine:m{idx}", t_e=now))
        watcher.run_once(t=now)
        assert len(store) == batch_size

    assert batch_size * num_batches == 125_000


@pytest.mark.skipif(not _RUN_HEAVY_LOAD_TEST, reason="opt-in: set RUN_HEAVY_LOAD_TEST=1 to run this larger-scale proxy benchmark")
def test_reads_stay_fast_under_larger_scale_concurrent_pruning():
    """100x the resident edge count of 2.8's smoke test (200k vs. 2k) --
    same sub-millisecond proxy-read assertion, at a scale closer to (but
    still nowhere near) enterprise volume."""
    store = ActiveGraphStore()
    edges = [_edge(src=f"User:u{i}", dst=f"Machine:m{i}", t_e=float(i)) for i in range(200_000)]
    for edge in edges:
        store.upsert(edge)

    watcher = PruningWatcher(
        store=store,
        decay_engine=DecayEngine(),
        epsilon_controller=EpsilonController(epsilon_min=0.3, epsilon_max=0.3),
        cold_storage=InMemoryColdStorageWriter(),
        memory_probe=lambda: None,
        poll_interval=0.01,
    )

    watcher.start()
    try:
        latencies = []
        deadline = time.time() + 2.0
        i = 0
        while time.time() < deadline:
            edge_id = edges[i % len(edges)].edge_id
            start = time.perf_counter()
            store.get(edge_id)
            latencies.append(time.perf_counter() - start)
            i += 1
        latencies.sort()
        median = latencies[len(latencies) // 2]
        p99 = latencies[int(len(latencies) * 0.99)]
    finally:
        watcher.stop(timeout=2.0)

    assert median < 0.001
    assert p99 < 0.005
