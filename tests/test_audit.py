import json

from t_gnn.audit import AuditLogger, FileAuditSink, InMemoryAuditSink, read_records
from t_gnn.motif_engine import MotifResetBus, MotifResetEvent
from t_gnn.pruning import PruneEventBus, PrunedEdgeEvent
from t_gnn.schema import Edge


def _edge(src="Machine:A", dst="Machine:B", protocol="RDP", t_e=0.0):
    return Edge(src=src, dst=dst, edge_type="Authentication", protocol=protocol, t_e=t_e, w_0=1.0)


# --- AuditLogger.log_prune / log_motif_reset -------------------------------------


def test_log_prune_writes_full_record():
    sink = InMemoryAuditSink()
    logger = AuditLogger(sink)
    edge = _edge()

    logger.log_prune(PrunedEdgeEvent(edge=edge, w_at_prune=0.002, pruned_at=100.0))

    assert len(sink.records) == 1
    record = sink.records[0]
    assert record["type"] == "prune"
    assert record["edge_id"] == edge.edge_id
    assert record["src"] == edge.src
    assert record["dst"] == edge.dst
    assert record["protocol"] == "RDP"
    assert record["w_at_prune"] == 0.002
    assert record["pruned_at"] == 100.0
    assert "logged_at" in record


def test_log_motif_reset_writes_full_record():
    sink = InMemoryAuditSink()
    logger = AuditLogger(sink)

    logger.log_motif_reset(MotifResetEvent(
        motif_name="lateral_pivot", chain_key="Machine:B",
        triggering_edge_id="edge-123", matched_edges=["edge-123"], reset_at=50.0,
    ))

    assert len(sink.records) == 1
    record = sink.records[0]
    assert record["type"] == "motif_reset"
    assert record["motif_name"] == "lateral_pivot"
    assert record["chain_key"] == "Machine:B"
    assert record["triggering_edge_id"] == "edge-123"
    assert record["reset_at"] == 50.0


# --- Auto-subscription to PruneEventBus/MotifResetBus ---------------------------


def test_auto_subscribes_to_prune_bus():
    sink = InMemoryAuditSink()
    prune_bus = PruneEventBus()
    AuditLogger(sink, prune_bus=prune_bus)

    prune_bus.publish(PrunedEdgeEvent(edge=_edge(), w_at_prune=0.01, pruned_at=1.0))

    assert len(sink.records) == 1
    assert sink.records[0]["type"] == "prune"


def test_auto_subscribes_to_reset_bus():
    sink = InMemoryAuditSink()
    reset_bus = MotifResetBus()
    AuditLogger(sink, reset_bus=reset_bus)

    reset_bus.publish(MotifResetEvent(
        motif_name="m", chain_key="k", triggering_edge_id="e", matched_edges=["e"], reset_at=1.0,
    ))

    assert len(sink.records) == 1
    assert sink.records[0]["type"] == "motif_reset"


def test_subscribes_to_both_buses_independently():
    sink = InMemoryAuditSink()
    prune_bus = PruneEventBus()
    reset_bus = MotifResetBus()
    AuditLogger(sink, prune_bus=prune_bus, reset_bus=reset_bus)

    prune_bus.publish(PrunedEdgeEvent(edge=_edge(), w_at_prune=0.01, pruned_at=1.0))
    reset_bus.publish(MotifResetEvent(
        motif_name="m", chain_key="k", triggering_edge_id="e", matched_edges=["e"], reset_at=2.0,
    ))

    assert {r["type"] for r in sink.records} == {"prune", "motif_reset"}


# --- FileAuditSink ---------------------------------------------------------------


def test_file_sink_appends_newline_delimited_json(tmp_path):
    path = tmp_path / "audit" / "log.jsonl"
    sink = FileAuditSink(path)

    sink.write({"type": "prune", "edge_id": "a"})
    sink.write({"type": "motif_reset", "chain_key": "b"})

    lines = path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["edge_id"] == "a"
    assert json.loads(lines[1])["chain_key"] == "b"


def test_file_sink_creates_parent_directories(tmp_path):
    path = tmp_path / "nested" / "dirs" / "log.jsonl"
    FileAuditSink(path)
    assert path.parent.is_dir()


# --- read_records (tasks.md F0.8) ------------------------------------------------


def test_read_records_missing_file_returns_empty_list(tmp_path):
    assert read_records(tmp_path / "does-not-exist.log") == []


def test_read_records_returns_newest_first(tmp_path):
    path = tmp_path / "audit.log"
    sink = FileAuditSink(path)
    sink.write({"type": "prune", "edge_id": "a", "logged_at": 1.0})
    sink.write({"type": "prune", "edge_id": "b", "logged_at": 2.0})
    sink.write({"type": "prune", "edge_id": "c", "logged_at": 3.0})

    records = read_records(path)

    assert [r["edge_id"] for r in records] == ["c", "b", "a"]


def test_read_records_filters_by_since(tmp_path):
    path = tmp_path / "audit.log"
    sink = FileAuditSink(path)
    sink.write({"type": "prune", "edge_id": "a", "logged_at": 1.0})
    sink.write({"type": "prune", "edge_id": "b", "logged_at": 2.0})
    sink.write({"type": "prune", "edge_id": "c", "logged_at": 3.0})

    records = read_records(path, since=2.0)

    assert {r["edge_id"] for r in records} == {"b", "c"}


def test_read_records_filters_by_type(tmp_path):
    path = tmp_path / "audit.log"
    sink = FileAuditSink(path)
    sink.write({"type": "prune", "edge_id": "a", "logged_at": 1.0})
    sink.write({"type": "motif_reset", "chain_key": "k", "logged_at": 2.0})

    records = read_records(path, record_type="motif_reset")

    assert len(records) == 1
    assert records[0]["chain_key"] == "k"


def test_read_records_skips_blank_lines(tmp_path):
    path = tmp_path / "audit.log"
    path.write_text('{"type": "prune", "edge_id": "a", "logged_at": 1.0}\n\n', encoding="utf-8")

    records = read_records(path)

    assert len(records) == 1
