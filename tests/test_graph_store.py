import threading

import torch

from t_gnn.graph_store import ActiveGraphStore
from t_gnn.schema import Edge


def _edge(src="User:alice", dst="Machine:C1042", t_e=0.0, protocol="RDP"):
    return Edge(src=src, dst=dst, edge_type="Authentication", protocol=protocol, t_e=t_e, w_0=1.0)


def test_upsert_and_get_round_trip():
    store = ActiveGraphStore()
    edge = _edge()
    store.upsert(edge)
    assert store.get(edge.edge_id) is edge
    assert len(store) == 1


def test_remove_returns_edge_and_shrinks_store():
    store = ActiveGraphStore()
    edge = _edge()
    store.upsert(edge)

    removed = store.remove(edge.edge_id)
    assert removed is edge
    assert len(store) == 0
    assert store.get(edge.edge_id) is None


def test_remove_missing_edge_returns_none():
    store = ActiveGraphStore()
    assert store.remove("does-not-exist") is None


def test_upsert_same_edge_id_replaces_not_duplicates():
    store = ActiveGraphStore()
    edge = _edge(t_e=0.0)
    refreshed = Edge(
        src=edge.src, dst=edge.dst, edge_type=edge.edge_type, protocol=edge.protocol,
        t_e=edge.t_e, w_0=edge.w_0, edge_id=edge.edge_id, w=0.5, w_evaluated_at=100.0,
    )
    store.upsert(edge)
    store.upsert(refreshed)

    assert len(store) == 1
    assert store.get(edge.edge_id).w == 0.5


def test_neighbors_out_in_both():
    store = ActiveGraphStore()
    store.upsert(_edge(src="Machine:A", dst="Machine:B"))
    store.upsert(_edge(src="Machine:C", dst="Machine:A"))

    assert store.neighbors("Machine:A", direction="out") == ["Machine:B"]
    assert store.neighbors("Machine:A", direction="in") == ["Machine:C"]
    assert set(store.neighbors("Machine:A", direction="both")) == {"Machine:B", "Machine:C"}


def test_neighbors_empty_for_unknown_node():
    store = ActiveGraphStore()
    assert store.neighbors("Machine:ghost") == []


def test_detach_cleans_up_empty_adjacency_entries():
    store = ActiveGraphStore()
    edge = _edge(src="Machine:A", dst="Machine:B")
    store.upsert(edge)
    store.remove(edge.edge_id)

    # internal adjacency dicts shouldn't accumulate empty-set entries
    assert "Machine:A" not in store._outgoing  # noqa: SLF001 -- internal check
    assert "Machine:B" not in store._incoming  # noqa: SLF001 -- internal check


def test_edges_returns_snapshot_not_live_view():
    store = ActiveGraphStore()
    store.upsert(_edge())
    snapshot = store.edges()
    store.upsert(_edge(src="User:bob"))

    assert len(snapshot) == 1
    assert len(store) == 2


def test_to_pyg_edge_index_shape_and_dtype():
    store = ActiveGraphStore()
    store.upsert(_edge(src="Machine:A", dst="Machine:B"))
    store.upsert(_edge(src="Machine:B", dst="Machine:C"))

    edge_index, edge_ids, node_index = store.to_pyg_edge_index()

    assert edge_index.shape == (2, 2)
    assert edge_index.dtype == torch.long
    assert len(edge_ids) == 2
    assert set(node_index.keys()) == {"Machine:A", "Machine:B", "Machine:C"}


def test_to_pyg_edge_index_maps_columns_to_correct_nodes():
    store = ActiveGraphStore()
    edge = _edge(src="Machine:A", dst="Machine:B")
    store.upsert(edge)

    edge_index, edge_ids, node_index = store.to_pyg_edge_index()

    col = edge_ids.index(edge.edge_id)
    assert edge_index[0, col].item() == node_index["Machine:A"]
    assert edge_index[1, col].item() == node_index["Machine:B"]


def test_to_pyg_edge_index_empty_store():
    store = ActiveGraphStore()
    edge_index, edge_ids, node_index = store.to_pyg_edge_index()
    assert edge_index.shape == (2, 0)
    assert edge_ids == []
    assert node_index == {}


def test_concurrent_upsert_and_remove_do_not_corrupt_store():
    store = ActiveGraphStore()
    n = 200
    edges = [_edge(src=f"User:u{i}", dst=f"Machine:m{i}", t_e=float(i)) for i in range(n)]

    def _inserter():
        for e in edges:
            store.upsert(e)

    def _remover():
        for e in edges:
            store.remove(e.edge_id)

    insert_thread = threading.Thread(target=_inserter)
    remove_thread = threading.Thread(target=_remover)
    insert_thread.start()
    remove_thread.start()
    insert_thread.join()
    remove_thread.join()

    # Regardless of interleaving, the store must end up internally consistent:
    # every remaining edge's endpoints must appear in the adjacency indexes.
    for edge in store.edges():
        assert edge.edge_id in store._outgoing.get(edge.src, set())  # noqa: SLF001
        assert edge.edge_id in store._incoming.get(edge.dst, set())  # noqa: SLF001
