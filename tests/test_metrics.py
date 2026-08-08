from t_gnn.graph_store import ActiveGraphStore
from t_gnn.metrics import MetricsCollector, RollingRateCounter
from t_gnn.motif_engine import MotifAlertBus, MotifCompletionEvent, MotifResetBus, MotifResetEvent
from t_gnn.pruning import PruneEventBus, PruningStats, PrunedEdgeEvent
from t_gnn.schema import Edge


def _edge(src="Machine:A", dst="Machine:B", t_e=0.0):
    return Edge(src=src, dst=dst, edge_type="Authentication", protocol="RDP", t_e=t_e, w_0=1.0)


# --- RollingRateCounter -----------------------------------------------------------


def test_rate_counts_events_within_the_trailing_window():
    counter = RollingRateCounter(window_seconds=10.0)
    for t in [0.0, 2.0, 4.0]:
        counter.record(t)

    assert counter.count(now=5.0) == 3
    assert counter.rate(now=5.0) == 3 / 10.0


def test_rate_evicts_events_outside_the_trailing_window():
    counter = RollingRateCounter(window_seconds=10.0)
    counter.record(0.0)
    counter.record(5.0)

    assert counter.count(now=20.0) == 0  # both events are now older than the 10s window
    assert counter.rate(now=20.0) == 0.0


# --- MetricsCollector: active graph size -----------------------------------------


def test_active_graph_size_reads_live_from_store():
    store = ActiveGraphStore()
    collector = MetricsCollector(store=store)
    assert collector.active_graph_size() == 0

    store.upsert(_edge())
    assert collector.active_graph_size() == 1


# --- MetricsCollector: prune rate (bus-subscribed) -------------------------------


def test_prune_rate_tracks_prune_event_bus():
    store = ActiveGraphStore()
    prune_bus = PruneEventBus()
    collector = MetricsCollector(store=store, window_seconds=60.0, prune_bus=prune_bus)

    for t in [0.0, 10.0, 20.0]:
        prune_bus.publish(PrunedEdgeEvent(edge=_edge(t_e=t), w_at_prune=0.01, pruned_at=t))

    assert collector.prune_rate.count(now=20.0) == 3


# --- MetricsCollector: motif hit/reset rate (bus-subscribed) ---------------------


def test_motif_hit_rate_tracks_completion_events():
    store = ActiveGraphStore()
    alert_bus = MotifAlertBus()
    collector = MetricsCollector(store=store, alert_bus=alert_bus)

    alert_bus.publish(MotifCompletionEvent(motif_name="m", chain_key="k", matched_edges=["e"], completed_at=5.0))

    assert collector.motif_hit_rate.count(now=5.0) == 1


def test_motif_reset_rate_tracks_reset_events():
    store = ActiveGraphStore()
    reset_bus = MotifResetBus()
    collector = MetricsCollector(store=store, reset_bus=reset_bus)

    reset_bus.publish(MotifResetEvent(motif_name="m", chain_key="k", triggering_edge_id="e", matched_edges=["e"], reset_at=5.0))

    assert collector.motif_reset_rate.count(now=5.0) == 1


# --- MetricsCollector: epsilon-over-time / inference latency (explicit observe) ---


def test_observe_pruning_pass_appends_epsilon_history():
    store = ActiveGraphStore()
    collector = MetricsCollector(store=store)

    collector.observe_pruning_pass(PruningStats(scanned=10, pruned=2, epsilon=0.05), t=1.0)
    collector.observe_pruning_pass(PruningStats(scanned=8, pruned=0, epsilon=0.03), t=2.0)

    assert [r.epsilon for r in collector.epsilon_history] == [0.05, 0.03]
    assert collector.epsilon_history[0].scanned == 10


def test_observe_pruning_pass_caps_history_length():
    store = ActiveGraphStore()
    collector = MetricsCollector(store=store, max_history=3)

    for i in range(5):
        collector.observe_pruning_pass(PruningStats(scanned=1, pruned=0, epsilon=float(i)), t=float(i))

    assert len(collector.epsilon_history) == 3
    assert [r.epsilon for r in collector.epsilon_history] == [2.0, 3.0, 4.0]


def test_observe_inference_pass_appends_latency_history():
    store = ActiveGraphStore()
    collector = MetricsCollector(store=store)

    collector.observe_inference_pass(results=[1, 2, 3], latency_seconds=0.002, t=1.0, trigger="scheduled")

    assert len(collector.inference_latency_history) == 1
    reading = collector.inference_latency_history[0]
    assert reading.latency_seconds == 0.002
    assert reading.trigger == "scheduled"
    assert reading.result_count == 3


# --- MetricsCollector.snapshot ----------------------------------------------------


def test_snapshot_reports_none_for_unobserved_series():
    store = ActiveGraphStore()
    collector = MetricsCollector(store=store)

    snapshot = collector.snapshot(now=0.0)

    assert snapshot.active_graph_size == 0
    assert snapshot.epsilon is None
    assert snapshot.latest_inference_latency_seconds is None
    assert snapshot.prune_rate_per_second == 0.0


def test_snapshot_aggregates_all_five_quantities():
    store = ActiveGraphStore()
    store.upsert(_edge())
    prune_bus = PruneEventBus()
    alert_bus = MotifAlertBus()
    reset_bus = MotifResetBus()
    collector = MetricsCollector(
        store=store, window_seconds=60.0, prune_bus=prune_bus, alert_bus=alert_bus, reset_bus=reset_bus,
    )

    prune_bus.publish(PrunedEdgeEvent(edge=_edge(), w_at_prune=0.01, pruned_at=0.0))
    alert_bus.publish(MotifCompletionEvent(motif_name="m", chain_key="k", matched_edges=["e"], completed_at=0.0))
    reset_bus.publish(MotifResetEvent(motif_name="m", chain_key="k", triggering_edge_id="e", matched_edges=["e"], reset_at=0.0))
    collector.observe_pruning_pass(PruningStats(scanned=1, pruned=1, epsilon=0.5), t=0.0)
    collector.observe_inference_pass(results=[1], latency_seconds=0.001, t=0.0, trigger="scheduled")

    snapshot = collector.snapshot(now=0.0)

    assert snapshot.active_graph_size == 1
    assert snapshot.prune_rate_per_second == 1 / 60.0
    assert snapshot.epsilon == 0.5
    assert snapshot.motif_hit_rate_per_second == 1 / 60.0
    assert snapshot.motif_reset_rate_per_second == 1 / 60.0
    assert snapshot.latest_inference_latency_seconds == 0.001


# --- MetricsCollector: total_edges_processed (F14.3) -----------------------------


def test_total_edges_processed_starts_at_zero():
    store = ActiveGraphStore()
    collector = MetricsCollector(store=store)
    assert collector.snapshot(now=0.0).total_edges_processed == 0


def test_total_edges_processed_increments_per_call_and_is_not_a_rate():
    store = ActiveGraphStore()
    collector = MetricsCollector(store=store)
    for _ in range(3):
        collector.observe_edge_processed()

    # Unlike the rate counters above, this never evicts old entries --
    # it's a running total for the life of this collector.
    assert collector.snapshot(now=0.0).total_edges_processed == 3
    assert collector.snapshot(now=10_000.0).total_edges_processed == 3
