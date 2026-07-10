import pytest
from neo4j import GraphDatabase
from neo4j.exceptions import ServiceUnavailable

from t_gnn.cold_storage import InMemoryColdStorageWriter, Neo4jColdStorageWriter, Neo4jConfig
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
