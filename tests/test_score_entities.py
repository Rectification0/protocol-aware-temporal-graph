"""Tests for the T-GNN per-entity scoring CLI (tasks.md 8.1)."""

from pathlib import Path

from t_gnn.data.stage_lanl import stage
from t_gnn.schema import Edge
from t_gnn.score_entities import score_staged_edges

_SAMPLE_LANL_FIXTURE = Path(__file__).resolve().parents[1] / "data" / "lanl" / "raw" / "sample_auth.txt.gz"


def _edge(src, dst, t_e, protocol="Kerberos", edge_type="Authentication", w_0=1.0):
    return Edge(src=src, dst=dst, edge_type=edge_type, protocol=protocol, t_e=t_e, w_0=w_0)


def test_score_staged_edges_scores_every_entity_left_in_the_graph():
    edges = [
        _edge("User:alice", "Machine:C1", t_e=0.0),
        _edge("User:bob", "Machine:C2", t_e=10.0),
    ]

    results = score_staged_edges(edges)

    entity_ids = {r.entity_id for r in results}
    assert entity_ids == {"User:alice", "Machine:C1", "User:bob", "Machine:C2"}
    assert all(r.trigger == "scheduled" for r in results)


def test_score_staged_edges_sorts_by_score_magnitude_descending():
    edges = [
        _edge("User:alice", "Machine:C1", t_e=0.0),
        _edge("User:bob", "Machine:C2", t_e=10.0),
        _edge("User:carol", "Machine:C3", t_e=20.0),
    ]

    results = score_staged_edges(edges)

    magnitudes = [abs(r.score) for r in results]
    assert magnitudes == sorted(magnitudes, reverse=True)


def test_score_staged_edges_respects_top_n():
    edges = [
        _edge("User:alice", "Machine:C1", t_e=0.0),
        _edge("User:bob", "Machine:C2", t_e=10.0),
        _edge("User:carol", "Machine:C3", t_e=20.0),
    ]

    results = score_staged_edges(edges, top_n=2)

    assert len(results) == 2


def test_score_staged_edges_fires_motif_fast_path_during_replay():
    """A completed lateral_pivot chain (the seed motif from config/motifs.yaml)
    should drive TGNNInferenceEngine's 5.3 fast path inline during replay --
    exercised here indirectly via the final scores still including both
    hops' entities (the fast path itself runs synchronously inside
    MotifEngine.on_edge(), see motif_engine.py)."""
    hop1 = _edge("Machine:C2001", "Machine:C2042", t_e=0.0)
    hop2 = Edge(
        src="User:C2042-admin", dst="Machine:C3000", edge_type="RemoteCodeExecution",
        protocol="RDP", t_e=3600.0, w_0=1.0,
    )

    results = score_staged_edges([hop1, hop2])

    entity_ids = {r.entity_id for r in results}
    assert "Machine:C2042" in entity_ids


def test_score_staged_edges_smoke_test_against_sample_lanl_fixture(tmp_path):
    """Mirrors test_pilot.py's own smoke test: exercises the CLI's
    replay-then-score path end-to-end against real staged LANL data,
    without asserting anything about the untrained reference model's
    specific scores (specs.md §4's non-goal) beyond it producing one
    per entity."""
    staged_dir = tmp_path / "staged"
    stats = stage(_SAMPLE_LANL_FIXTURE, staged_dir)
    assert stats.edges_written > 0

    edges = []
    for shard in sorted(staged_dir.glob("shard-*.jsonl")):
        for line in shard.read_text(encoding="utf-8").splitlines():
            edges.append(Edge.from_json(line))
    edges.sort(key=lambda e: e.t_e)

    results = score_staged_edges(edges)

    assert len(results) > 0
    assert all(isinstance(r.score, float) for r in results)
