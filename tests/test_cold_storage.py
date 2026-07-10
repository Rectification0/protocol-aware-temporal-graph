import time

import pytest
from neo4j import GraphDatabase
from neo4j.exceptions import ServiceUnavailable

from t_gnn.cold_storage import BufferedColdStorageWriter, InMemoryColdStorageWriter, Neo4jColdStorageWriter, Neo4jConfig
from t_gnn.decay import DecayEngine
from t_gnn.graph_store import ActiveGraphStore
from t_gnn.pruning import EpsilonController, PruningWatcher
from t_gnn.schema import Edge

TEST_CONFIG = Neo4jConfig()


def _neo4j_reachable() -> bool:
    try:
        driver = GraphDatabase.driver(TEST_CONFIG.uri, auth=(TEST_CONFIG.user, TEST_CONFIG.password))
        try:
            driver.verify_connectivity()
            return True
        finally:
            driver.close()
    except ServiceUnavailable:
        return False
    except Exception:
        return False


requires_neo4j = pytest.mark.skipif(
    not _neo4j_reachable(),
    reason="Neo4j not reachable at bolt://localhost:7687 -- run `docker compose up -d` first",
)


def _edge(src="User:alice", dst="Machine:C1042", protocol="RDP", t_e=100.0):
    return Edge(src=src, dst=dst, edge_type="Authentication", protocol=protocol, t_e=t_e, w_0=1.0, source_system="test")


def test_in_memory_writer_records_writes():
    writer = InMemoryColdStorageWriter()
    edge = _edge()

    writer.write(edge, w_at_prune=0.01, pruned_at=500.0)

    assert len(writer.written) == 1
    written_edge, w_at_prune, pruned_at = writer.written[0]
    assert written_edge is edge
    assert w_at_prune == 0.01
    assert pruned_at == 500.0


@requires_neo4j
def test_neo4j_writer_round_trips_edge_metadata():
    edge = _edge(src=f"User:calibration-test-{id(object())}", dst="Machine:calibration-target")

    with Neo4jColdStorageWriter(TEST_CONFIG) as writer:
        writer.write(edge, w_at_prune=0.0123, pruned_at=999.0)

        with writer._driver.session() as session:  # noqa: SLF001 -- test-only introspection
            record = session.run(
                "MATCH (src:Entity {id: $src})-[r:PRUNED_EDGE {edge_id: $edge_id}]->(dst:Entity {id: $dst}) "
                "RETURN r",
                src=edge.src,
                dst=edge.dst,
                edge_id=edge.edge_id,
            ).single()

    assert record is not None
    rel = record["r"]
    assert rel["protocol"] == "RDP"
    assert rel["edge_type"] == "Authentication"
    assert rel["t_e"] == 100.0
    assert rel["w_0"] == 1.0
    assert rel["w_at_prune"] == 0.0123
    assert rel["pruned_at"] == 999.0
    assert rel["source_system"] == "test"


@requires_neo4j
def test_neo4j_writer_creates_entity_indexes():
    with Neo4jColdStorageWriter(TEST_CONFIG) as writer:
        with writer._driver.session() as session:  # noqa: SLF001
            index_names = {record["name"] for record in session.run("SHOW INDEXES YIELD name")}

    assert "entity_id" in index_names
    assert "pruned_edge_ts" in index_names


# --- BufferedColdStorageWriter (tasks.md 6.4) ------------------------------------


def test_write_enqueues_without_touching_underlying_writer():
    underlying = InMemoryColdStorageWriter()
    buffered = BufferedColdStorageWriter(underlying)
    edge = _edge()

    buffered.write(edge, w_at_prune=0.01, pruned_at=500.0)

    assert buffered.qsize() == 1
    assert underlying.written == []  # not yet drained


def test_drain_once_processes_a_queued_record():
    underlying = InMemoryColdStorageWriter()
    buffered = BufferedColdStorageWriter(underlying)
    edge = _edge()
    buffered.write(edge, w_at_prune=0.01, pruned_at=500.0)

    drained = buffered.drain_once(timeout=1.0)

    assert drained is True
    assert buffered.qsize() == 0
    assert len(underlying.written) == 1
    assert underlying.written[0][0] is edge


def test_drain_once_returns_false_when_queue_empty():
    buffered = BufferedColdStorageWriter(InMemoryColdStorageWriter())
    assert buffered.drain_once(timeout=0.05) is False


def test_drain_once_retries_failed_write_then_succeeds():
    class FlakyWriter:
        def __init__(self):
            self.attempts = 0
            self.written = []

        def write(self, edge, w_at_prune, pruned_at):
            self.attempts += 1
            if self.attempts < 2:
                raise RuntimeError("transient neo4j hiccup")
            self.written.append(edge)

    flaky = FlakyWriter()
    buffered = BufferedColdStorageWriter(flaky, max_retries=3, retry_backoff=0.0)
    edge = _edge()
    buffered.write(edge, w_at_prune=0.01, pruned_at=500.0)

    buffered.drain_once(timeout=1.0)  # fails, re-enqueues
    buffered.drain_once(timeout=1.0)  # succeeds

    assert flaky.attempts == 2
    assert flaky.written == [edge]
    assert buffered.dropped == 0


def test_drain_once_drops_record_after_exhausting_retries():
    class AlwaysFailingWriter:
        def write(self, edge, w_at_prune, pruned_at):
            raise RuntimeError("neo4j permanently unreachable")

    buffered = BufferedColdStorageWriter(AlwaysFailingWriter(), max_retries=2, retry_backoff=0.0)
    buffered.write(_edge(), w_at_prune=0.01, pruned_at=500.0)

    buffered.drain_once(timeout=1.0)  # attempt 1 fails, re-enqueues
    buffered.drain_once(timeout=1.0)  # attempt 2 fails, exhausts retries -> dropped

    assert buffered.dropped == 1
    assert buffered.qsize() == 0


def test_start_stop_drains_in_background():
    underlying = InMemoryColdStorageWriter()
    buffered = BufferedColdStorageWriter(underlying)
    buffered.write(_edge(), w_at_prune=0.01, pruned_at=500.0)

    buffered.start()
    try:
        deadline = time.time() + 2.0
        while time.time() < deadline and not underlying.written:
            time.sleep(0.02)
        assert underlying.written
    finally:
        buffered.stop(timeout=2.0)


def test_pruning_watcher_does_not_block_on_a_slow_cold_storage_write():
    """The core 6.4 guarantee: PruningWatcher.run_once() returns promptly
    even though the *real* underlying writer is artificially slow -- the
    slow write happens on BufferedColdStorageWriter's own background
    thread, never on run_once()'s caller."""

    class SlowWriter:
        def write(self, edge, w_at_prune, pruned_at):
            time.sleep(1.0)

    store = ActiveGraphStore()
    for i in range(5):
        store.upsert(Edge(
            src=f"Machine:A{i}", dst=f"Machine:B{i}", edge_type="Authentication",
            protocol="RDP", t_e=0.0, w_0=1.0,
        ))

    buffered = BufferedColdStorageWriter(SlowWriter())
    watcher = PruningWatcher(
        store=store, decay_engine=DecayEngine(),
        epsilon_controller=EpsilonController(epsilon_min=0.9, epsilon_max=0.9),
        cold_storage=buffered,
    )

    started = time.time()
    stats = watcher.run_once(t=3600.0 * 10)
    elapsed = time.time() - started

    assert stats.pruned == 5
    assert elapsed < 1.0  # would be >= 5s if writes were synchronous through SlowWriter
    assert buffered.qsize() == 5  # queued, not yet drained
