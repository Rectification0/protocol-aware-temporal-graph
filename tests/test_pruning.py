import time

from t_gnn.cold_storage import InMemoryColdStorageWriter
from t_gnn.decay import DecayEngine
from t_gnn.graph_store import ActiveGraphStore
from t_gnn.pruning import EpsilonController, PruneEventBus, PruningWatcher
from t_gnn.schema import Edge


def _edge(src="User:alice", dst="Machine:C1042", protocol="RDP", t_e=0.0, w_0=1.0):
    return Edge(src=src, dst=dst, edge_type="Authentication", protocol=protocol, t_e=t_e, w_0=w_0)


# --- EpsilonController (2.3) ---------------------------------------------------


def test_epsilon_at_or_below_low_watermark_uses_epsilon_min():
    controller = EpsilonController(epsilon_min=0.01, epsilon_max=0.5, low_watermark=70, high_watermark=90)
    assert controller.compute_epsilon(current_edge_count=0, memory_percent=50) == 0.01


def test_epsilon_at_or_above_high_watermark_uses_epsilon_max():
    controller = EpsilonController(epsilon_min=0.01, epsilon_max=0.5, low_watermark=70, high_watermark=90)
    assert controller.compute_epsilon(current_edge_count=0, memory_percent=95) == 0.5


def test_epsilon_interpolates_between_watermarks():
    controller = EpsilonController(epsilon_min=0.0, epsilon_max=1.0, low_watermark=70, high_watermark=90)
    # Halfway between 70 and 90 -> halfway between epsilon_min and epsilon_max.
    assert controller.compute_epsilon(current_edge_count=0, memory_percent=80) == 0.5


def test_epsilon_uses_graph_size_pressure_when_no_memory_reading():
    controller = EpsilonController(epsilon_min=0.0, epsilon_max=1.0, max_edges=100)
    assert controller.compute_epsilon(current_edge_count=100, memory_percent=None) == 1.0
    assert controller.compute_epsilon(current_edge_count=0, memory_percent=None) == 0.0


def test_epsilon_takes_max_of_memory_and_size_pressure():
    controller = EpsilonController(epsilon_min=0.0, epsilon_max=1.0, low_watermark=70, high_watermark=90, max_edges=100)
    # Low memory pressure (50% -> 0 pressure) but full graph (100/100 -> 1.0 pressure).
    assert controller.compute_epsilon(current_edge_count=100, memory_percent=50) == 1.0


def test_epsilon_rejects_invalid_bounds():
    try:
        EpsilonController(epsilon_min=0.5, epsilon_max=0.1)
        assert False, "expected ValueError"
    except ValueError:
        pass


# --- PruningWatcher.run_once (2.2/2.4/2.5) --------------------------------------


def _watcher(store, epsilon_min=0.5, epsilon_max=0.5, event_bus=None, cold_storage=None):
    return PruningWatcher(
        store=store,
        decay_engine=DecayEngine(),
        epsilon_controller=EpsilonController(epsilon_min=epsilon_min, epsilon_max=epsilon_max),
        cold_storage=cold_storage or InMemoryColdStorageWriter(),
        event_bus=event_bus,
        memory_probe=lambda: None,
    )


def test_run_once_prunes_edges_below_epsilon():
    store = ActiveGraphStore()
    decayed_edge = _edge(protocol="RDP", t_e=0.0, w_0=1.0)  # RDP decays fast
    store.upsert(decayed_edge)

    watcher = _watcher(store, epsilon_min=0.9, epsilon_max=0.9)
    stats = watcher.run_once(t=3600.0 * 10)  # 10 hours later -- well past RDP's ~1h half-life

    assert stats.scanned == 1
    assert stats.pruned == 1
    assert len(store) == 0


def test_run_once_keeps_edges_above_epsilon():
    store = ActiveGraphStore()
    fresh_edge = _edge(protocol="SMB", t_e=0.0, w_0=1.0)
    store.upsert(fresh_edge)

    watcher = _watcher(store, epsilon_min=0.01, epsilon_max=0.01)
    stats = watcher.run_once(t=1.0)  # barely any elapsed time

    assert stats.pruned == 0
    assert len(store) == 1


def test_run_once_writes_to_cold_storage_before_removing():
    store = ActiveGraphStore()
    edge = _edge(protocol="RDP", t_e=0.0)
    store.upsert(edge)
    cold_storage = InMemoryColdStorageWriter()

    watcher = _watcher(store, epsilon_min=0.9, epsilon_max=0.9, cold_storage=cold_storage)
    watcher.run_once(t=3600.0 * 10)

    assert len(cold_storage.written) == 1
    written_edge, w_at_prune, pruned_at = cold_storage.written[0]
    assert written_edge.edge_id == edge.edge_id
    assert w_at_prune < 0.9
    assert pruned_at == 3600.0 * 10


def test_run_once_publishes_prune_event():
    store = ActiveGraphStore()
    edge = _edge(protocol="RDP", t_e=0.0)
    store.upsert(edge)
    bus = PruneEventBus()
    received = []
    bus.subscribe(received.append)

    watcher = _watcher(store, epsilon_min=0.9, epsilon_max=0.9, event_bus=bus)
    watcher.run_once(t=3600.0 * 10)

    assert len(received) == 1
    assert received[0].edge.edge_id == edge.edge_id


def test_run_once_failed_write_leaves_edge_active_for_retry():
    class FailingColdStorage:
        def write(self, edge, w_at_prune, pruned_at):
            raise RuntimeError("neo4j unreachable")

    store = ActiveGraphStore()
    edge = _edge(protocol="RDP", t_e=0.0)
    store.upsert(edge)

    watcher = _watcher(store, epsilon_min=0.9, epsilon_max=0.9, cold_storage=FailingColdStorage())
    stats = watcher.run_once(t=3600.0 * 10)

    assert stats.write_failures == 1
    assert stats.pruned == 0
    assert len(store) == 1  # edge was NOT removed despite breaching epsilon


def test_run_once_epsilon_reflects_graph_size_pressure():
    store = ActiveGraphStore()
    store.upsert(_edge(protocol="RDP", t_e=0.0, w_0=1.0))

    controller = EpsilonController(epsilon_min=0.0, epsilon_max=0.99, max_edges=1)
    watcher = PruningWatcher(
        store=store,
        decay_engine=DecayEngine(),
        epsilon_controller=controller,
        cold_storage=InMemoryColdStorageWriter(),
        memory_probe=lambda: None,
    )
    # Graph is at 100% of max_edges -> epsilon_max (0.99) -- after ~60s RDP's
    # fast decay drops the edge just under 0.99, forcing a prune purely from
    # size pressure rather than the elapsed time being large in absolute terms.
    stats = watcher.run_once(t=60.0)
    assert stats.epsilon == 0.99
    assert stats.pruned == 1


# --- Background thread lifecycle (2.2/2.6) --------------------------------------


def test_start_stop_prunes_in_background():
    store = ActiveGraphStore()
    # w_0 near zero -- immediately prunable regardless of elapsed time.
    store.upsert(_edge(protocol="RDP", t_e=0.0, w_0=0.001))
    watcher = _watcher(store, epsilon_min=0.5, epsilon_max=0.5)
    watcher.poll_interval = 0.05

    watcher.start()
    try:
        deadline = time.time() + 2.0
        while time.time() < deadline and len(store) > 0:
            time.sleep(0.02)
        assert len(store) == 0
    finally:
        watcher.stop(timeout=2.0)


def test_stop_is_idempotent_and_joins_thread():
    store = ActiveGraphStore()
    watcher = _watcher(store)
    watcher.start()
    watcher.stop(timeout=2.0)
    watcher.stop(timeout=2.0)  # calling stop again should not raise


# --- Backlog B.12: max_edges as a hard ceiling -----------------------------------


def _capped_watcher(store, max_edges, event_bus=None, cold_storage=None, epsilon=0.01):
    return PruningWatcher(
        store=store,
        decay_engine=DecayEngine(),
        epsilon_controller=EpsilonController(epsilon_min=epsilon, epsilon_max=epsilon, max_edges=max_edges),
        cold_storage=cold_storage or InMemoryColdStorageWriter(),
        event_bus=event_bus,
        memory_probe=lambda: None,
    )


def _fresh_edges(n):
    """Edges all well above epsilon at t=1.0, with distinct weights w_0 = 0.5..~1."""
    return [_edge(src=f"User:u{i}", protocol="SMB", t_e=0.0, w_0=0.5 + i / (2 * n)) for i in range(n)]


def test_cap_prunes_lowest_weight_survivors_down_to_max_edges():
    store = ActiveGraphStore()
    edges = _fresh_edges(20)
    for edge in edges:
        store.upsert(edge)

    stats = _capped_watcher(store, max_edges=15).run_once(t=1.0)

    assert len(store) == 15
    assert stats.pruned == stats.capped == 5
    assert {e.edge_id for e in store.edges()} == {e.edge_id for e in edges[5:]}  # the five lightest went


def test_cap_counts_epsilon_prunes_first():
    store = ActiveGraphStore()
    stale = [_edge(src=f"User:old{i}", protocol="RDP", t_e=0.0) for i in range(3)]  # RDP: long decayed by t
    fresh = [_edge(src=f"User:u{i}", protocol="SMB", t_e=36_000.0, w_0=0.5 + i / 20) for i in range(10)]
    for edge in stale + fresh:
        store.upsert(edge)

    stats = _capped_watcher(store, max_edges=8, epsilon=0.3).run_once(t=36_001.0)

    assert stats.pruned == 5 and stats.capped == 2  # 3 by epsilon, then 2 more to reach 8
    assert len(store) == 8


def test_cap_writes_cold_storage_and_publishes_events_tagged_cap():
    store = ActiveGraphStore()
    for edge in _fresh_edges(6):
        store.upsert(edge)
    bus = PruneEventBus()
    received = []
    bus.subscribe(received.append)
    cold_storage = InMemoryColdStorageWriter()

    _capped_watcher(store, max_edges=4, event_bus=bus, cold_storage=cold_storage).run_once(t=1.0)

    assert [e.reason for e in received] == ["cap", "cap"]
    assert {e.edge.edge_id for e in received} == {written.edge_id for written, _, _ in cold_storage.written}


def test_cap_failed_write_leaves_the_edge_and_the_graph_over_the_cap():
    class FailingColdStorage:
        def write(self, edge, w_at_prune, pruned_at):
            raise RuntimeError("neo4j unreachable")

    store = ActiveGraphStore()
    for edge in _fresh_edges(5):
        store.upsert(edge)

    stats = _capped_watcher(store, max_edges=3, cold_storage=FailingColdStorage()).run_once(t=1.0)

    assert stats.write_failures == 2 and stats.capped == 0
    assert len(store) == 5  # nothing removed without its cold-storage copy (FR2.4)


def test_no_cap_when_max_edges_unset_or_not_exceeded():
    store = ActiveGraphStore()
    for edge in _fresh_edges(5):
        store.upsert(edge)

    assert _capped_watcher(store, max_edges=None).run_once(t=1.0).capped == 0
    assert _capped_watcher(store, max_edges=5).run_once(t=1.0).capped == 0
    assert len(store) == 5


def test_epsilon_prunes_are_tagged_decay():
    store = ActiveGraphStore()
    store.upsert(_edge(protocol="RDP", t_e=0.0))
    bus = PruneEventBus()
    received = []
    bus.subscribe(received.append)

    _watcher(store, epsilon_min=0.9, epsilon_max=0.9, event_bus=bus).run_once(t=3600.0 * 10)

    assert [e.reason for e in received] == ["decay"]
