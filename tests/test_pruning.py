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
