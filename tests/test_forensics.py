import pytest
from neo4j import GraphDatabase
from neo4j.exceptions import ServiceUnavailable

from t_gnn.cold_storage import Neo4jColdStorageWriter, Neo4jConfig
from t_gnn.decay import DecayEngine
from t_gnn.forensics import Neo4jForensicQueryAPI
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


def _edge(src, dst, edge_type="Authentication", protocol="RDP", t_e=0.0, raw_event_id=None):
    return Edge(
        src=src, dst=dst, edge_type=edge_type, protocol=protocol, t_e=t_e, w_0=1.0,
        source_system="test", raw_event_id=raw_event_id,
    )


@requires_neo4j
def test_get_edge_round_trips_full_metadata():
    suffix = id(object())
    edge = _edge(
        src=f"User:forensic-{suffix}", dst=f"Machine:forensic-{suffix}",
        protocol="SMB", t_e=100.0, raw_event_id="evt-123",
    )

    with Neo4jColdStorageWriter(TEST_CONFIG) as writer:
        writer.write(edge, w_at_prune=0.042, pruned_at=999.0)

    with Neo4jForensicQueryAPI(TEST_CONFIG) as api:
        record = api.get_edge(edge.edge_id)

    assert record is not None
    assert record.edge_id == edge.edge_id
    assert record.src == edge.src
    assert record.dst == edge.dst
    assert record.edge_type == "Authentication"
    assert record.protocol == "SMB"
    assert record.t_e == 100.0
    assert record.w_0 == 1.0
    assert record.w_at_prune == 0.042
    assert record.pruned_at == 999.0
    assert record.source_system == "test"
    assert record.raw_event_id == "evt-123"


@requires_neo4j
def test_get_edge_returns_none_for_unknown_id():
    with Neo4jForensicQueryAPI(TEST_CONFIG) as api:
        assert api.get_edge("does-not-exist-" + str(id(object()))) is None


@requires_neo4j
def test_reconstruct_activity_filters_by_time_window_and_orders_chronologically():
    suffix = id(object())
    entity = f"Machine:forensic-window-{suffix}"
    in_window_1 = _edge(src=f"User:a-{suffix}", dst=entity, t_e=100.0)
    in_window_2 = _edge(src=entity, dst=f"Machine:b-{suffix}", t_e=150.0)
    outside_window = _edge(src=f"User:c-{suffix}", dst=entity, t_e=500.0)

    with Neo4jColdStorageWriter(TEST_CONFIG) as writer:
        writer.write(in_window_2, w_at_prune=0.01, pruned_at=200.0)  # written out of chronological order
        writer.write(in_window_1, w_at_prune=0.01, pruned_at=200.0)
        writer.write(outside_window, w_at_prune=0.01, pruned_at=600.0)

    with Neo4jForensicQueryAPI(TEST_CONFIG) as api:
        records = api.reconstruct_activity(entity, start=0.0, end=200.0)

    assert [r.edge_id for r in records] == [in_window_1.edge_id, in_window_2.edge_id]
    assert all(r.t_e <= 200.0 for r in records)


@requires_neo4j
def test_reconstruct_activity_matches_entity_as_either_endpoint():
    suffix = id(object())
    entity = f"Machine:forensic-endpoint-{suffix}"
    as_dst = _edge(src=f"Machine:x-{suffix}", dst=entity, t_e=10.0)
    as_src = _edge(src=entity, dst=f"Machine:y-{suffix}", t_e=20.0)

    with Neo4jColdStorageWriter(TEST_CONFIG) as writer:
        writer.write(as_dst, w_at_prune=0.01, pruned_at=50.0)
        writer.write(as_src, w_at_prune=0.01, pruned_at=50.0)

    with Neo4jForensicQueryAPI(TEST_CONFIG) as api:
        records = api.reconstruct_activity(entity, start=0.0, end=100.0)

    assert {r.edge_id for r in records} == {as_dst.edge_id, as_src.edge_id}


@requires_neo4j
def test_reconstruct_activity_empty_for_entity_with_no_pruned_edges():
    with Neo4jForensicQueryAPI(TEST_CONFIG) as api:
        records = api.reconstruct_activity(f"Machine:never-pruned-{id(object())}", start=0.0, end=1e12)
    assert records == []


@requires_neo4j
def test_forensic_query_api_creates_additional_indexes():
    with Neo4jForensicQueryAPI(TEST_CONFIG) as api:
        with api._driver.session() as session:  # noqa: SLF001 -- test-only introspection
            index_names = {record["name"] for record in session.run("SHOW INDEXES YIELD name")}

    assert "pruned_edge_t_e" in index_names
    assert "pruned_edge_id" in index_names


@requires_neo4j
def test_end_to_end_prune_then_forensic_reconstruction():
    """4.3: an edge pruned by the real PruningWatcher is fully queryable
    afterward via the forensic API, with all original metadata intact."""
    suffix = id(object())
    edge = _edge(
        src=f"Machine:e2e-{suffix}", dst=f"Machine:e2e-target-{suffix}",
        protocol="RDP", t_e=0.0, raw_event_id="sysmon-42",
    )
    store = ActiveGraphStore()
    store.upsert(edge)

    with Neo4jColdStorageWriter(TEST_CONFIG) as cold_storage:
        watcher = PruningWatcher(
            store=store, decay_engine=DecayEngine(),
            epsilon_controller=EpsilonController(epsilon_min=0.9, epsilon_max=0.9),
            cold_storage=cold_storage,
        )
        stats = watcher.run_once(t=3600.0 * 10)

    assert stats.pruned == 1

    with Neo4jForensicQueryAPI(TEST_CONFIG) as api:
        record = api.get_edge(edge.edge_id)

    assert record is not None
    assert record.raw_event_id == "sysmon-42"
    assert record.protocol == "RDP"
    assert record.w_at_prune < 0.9
    assert record.src == edge.src
    assert record.dst == edge.dst
