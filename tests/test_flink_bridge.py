"""Backlog B.1: applying the Flink job's weight refreshes to the live graph."""

import pytest

pytest.importorskip("confluent_kafka", reason="needs the [flink] extra: pip install -e '.[flink]'")

from t_gnn.flink.bridge import apply_weight_refresh  # noqa: E402
from t_gnn.graph_store import ActiveGraphStore  # noqa: E402
from t_gnn.schema import Edge  # noqa: E402


def _stored(store):
    edge = Edge(src="User:alice", dst="Machine:C1", edge_type="Authentication", protocol="RDP",
                t_e=1000.0, w_0=1.0, w=1.0, w_evaluated_at=1000.0)
    store.upsert(edge)
    return edge


def _refresh(edge, t, w):
    return {"edge_id": edge.edge_id, "t": t, "w": w, "lambda_p": 0.001, "expired": False}


def test_refresh_updates_a_live_edges_weight():
    store = ActiveGraphStore()
    edge = _stored(store)
    assert apply_weight_refresh(store, _refresh(edge, 1060.0, 0.9))
    assert store.get(edge.edge_id).w == 0.9
    assert store.get(edge.edge_id).w_evaluated_at == 1060.0


def test_refresh_never_resurrects_a_pruned_edge():
    store = ActiveGraphStore()
    edge = _stored(store)
    store.remove(edge.edge_id)
    assert not apply_weight_refresh(store, _refresh(edge, 1060.0, 0.9))
    assert store.get(edge.edge_id) is None


def test_stale_refresh_does_not_overwrite_a_newer_weight():
    store = ActiveGraphStore()
    edge = _stored(store)
    apply_weight_refresh(store, _refresh(edge, 1120.0, 0.8))
    assert not apply_weight_refresh(store, _refresh(edge, 1060.0, 0.9))
    assert store.get(edge.edge_id).w == 0.8
