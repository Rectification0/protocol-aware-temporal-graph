"""Tests for the distributed Active Graph Store + motif cache (tasks.md Backlog B.5)."""

from t_gnn.graph_store import ActiveGraphStore, ShardedActiveGraphStore
from t_gnn.motif_engine import InMemoryMotifStateStore, MotifEngine, ShardedMotifStateStore
from t_gnn.motifs import MotifDefinition, MotifStep
from t_gnn.schema import Edge
from t_gnn.sharding import stable_shard_index


def _edge(src, dst, t_e, protocol="Kerberos"):
    return Edge(src=src, dst=dst, edge_type="Authentication", protocol=protocol, t_e=t_e, w_0=1.0)


# --- stable_shard_index -------------------------------------------------------------


def test_stable_shard_index_is_deterministic_across_calls():
    assert stable_shard_index("Machine:C1042", 8) == stable_shard_index("Machine:C1042", 8)


def test_stable_shard_index_is_within_range():
    for i in range(200):
        assert 0 <= stable_shard_index(f"key-{i}", 5) < 5


def test_stable_shard_index_single_shard_always_zero():
    assert stable_shard_index("anything", 1) == 0


def test_stable_shard_index_rejects_zero_shards():
    import pytest
    with pytest.raises(ValueError):
        stable_shard_index("key", 0)


def test_stable_shard_index_distributes_across_multiple_shards():
    """Not a rigorous uniformity test -- just confirms routing isn't
    degenerate (e.g. everything landing on shard 0)."""
    seen = {stable_shard_index(f"Machine:C{i}", 4) for i in range(100)}
    assert len(seen) > 1


# --- ShardedActiveGraphStore ----------------------------------------------------------


def test_sharded_store_upsert_get_remove_round_trip():
    store = ShardedActiveGraphStore(num_shards=4)
    edge = _edge("User:alice", "Machine:C1", t_e=0.0)

    store.upsert(edge)
    assert store.get(edge.edge_id) == edge
    assert len(store) == 1

    removed = store.remove(edge.edge_id)
    assert removed == edge
    assert store.get(edge.edge_id) is None
    assert len(store) == 0


def test_sharded_store_distributes_edges_across_more_than_one_shard():
    store = ShardedActiveGraphStore(num_shards=4)
    for i in range(50):
        store.upsert(_edge(f"User:u{i}", f"Machine:m{i}", t_e=float(i)))

    non_empty_shards = sum(1 for shard in store.shards if len(shard) > 0)
    assert non_empty_shards > 1
    assert len(store) == 50


def test_sharded_store_edges_matches_total_across_shards():
    store = ShardedActiveGraphStore(num_shards=3)
    edges = [_edge(f"User:u{i}", f"Machine:m{i}", t_e=float(i)) for i in range(20)]
    for edge in edges:
        store.upsert(edge)

    assert {e.edge_id for e in store.edges()} == {e.edge_id for e in edges}


def test_sharded_store_neighbors_fans_out_across_shards():
    store = ShardedActiveGraphStore(num_shards=4)
    # Multiple edges from the same src, likely landing on different shards
    # (since edge_id includes dst/t_e, not just src) -- neighbors() must
    # still find all of them.
    for i in range(10):
        store.upsert(_edge("User:alice", f"Machine:m{i}", t_e=float(i)))

    neighbors = store.neighbors("User:alice", direction="out")
    assert set(neighbors) == {f"Machine:m{i}" for i in range(10)}


def test_sharded_store_to_pyg_edge_index_matches_single_store_semantics():
    edges = [_edge(f"User:u{i}", f"Machine:m{i}", t_e=float(i)) for i in range(15)]

    single = ActiveGraphStore()
    sharded = ShardedActiveGraphStore(num_shards=3)
    for edge in edges:
        single.upsert(edge)
        sharded.upsert(edge)

    single_edge_index, single_edge_ids, single_node_index = single.to_pyg_edge_index()
    sharded_edge_index, sharded_edge_ids, sharded_node_index = sharded.to_pyg_edge_index()

    assert set(sharded_edge_ids) == set(single_edge_ids)
    assert set(sharded_node_index.keys()) == set(single_node_index.keys())
    assert sharded_edge_index.shape == single_edge_index.shape


def test_sharded_store_rejects_zero_shards():
    import pytest
    with pytest.raises(ValueError):
        ShardedActiveGraphStore(num_shards=0)


# --- ShardedMotifStateStore -----------------------------------------------------------


def _sharded_motif_store(num_shards=4):
    return ShardedMotifStateStore([InMemoryMotifStateStore() for _ in range(num_shards)])


def test_sharded_motif_store_rejects_empty_shard_list():
    import pytest
    with pytest.raises(ValueError):
        ShardedMotifStateStore([])


def test_sharded_motif_store_routes_same_chain_key_to_same_shard():
    store = _sharded_motif_store()
    from t_gnn.motif_engine import MotifState

    state = MotifState(motif_name="m", chain_key="Machine:C1042", stage=1, started_at=0.0, last_edge_ts=0.0,
                        matched_edges=["e1"])
    store.set(state, ttl_seconds=100.0)

    fetched = store.get("m", "Machine:C1042")
    assert fetched is not None
    assert fetched.chain_key == "Machine:C1042"

    store.delete("m", "Machine:C1042")
    assert store.get("m", "Machine:C1042") is None


def test_sharded_motif_store_states_containing_edge_fans_out_across_shards():
    store = _sharded_motif_store()
    from t_gnn.motif_engine import MotifState

    # Several distinct chain keys, likely landing on different shards.
    for i in range(10):
        state = MotifState(
            motif_name="m", chain_key=f"Machine:C{i}", stage=1, started_at=0.0, last_edge_ts=0.0,
            matched_edges=["shared-edge-id"],
        )
        store.set(state, ttl_seconds=100.0)

    found = store.states_containing_edge("shared-edge-id")
    assert {s.chain_key for s in found} == {f"Machine:C{i}" for i in range(10)}


def test_motif_engine_completes_a_real_motif_using_sharded_state_store():
    """Integration check: MotifEngine doesn't care that its state_store is
    sharded -- the MotifStateStore protocol is all it depends on."""
    motif = MotifDefinition(
        name="lateral_pivot_test",
        window_seconds=14400.0,
        steps=(
            MotifStep(key_field="dst", src_type=frozenset({"Machine"}), dst_type=frozenset({"Machine"})),
            MotifStep(key_field="src", key_resolver="host_admin",
                      src_type=frozenset({"User"}), dst_type=frozenset({"Machine"})),
        ),
    )
    engine = MotifEngine(definitions=[motif], state_store=_sharded_motif_store(num_shards=3))

    hop1 = _edge("Machine:C2001", "Machine:C2042", t_e=0.0)
    hop2 = Edge(src="User:C2042-admin", dst="Machine:C3000", edge_type="RemoteCodeExecution",
                protocol="RDP", t_e=3600.0, w_0=1.0)

    assert engine.on_edge(hop1) == []
    completions = engine.on_edge(hop2)

    assert len(completions) == 1
    assert completions[0].chain_key == "Machine:C2042"
