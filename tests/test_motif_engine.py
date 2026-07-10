import pytest

from t_gnn.motif_engine import (
    InMemoryMotifStateStore,
    MotifAlertBus,
    MotifEngine,
)
from t_gnn.motifs import MotifDefinition, MotifRegistry, MotifStep
from t_gnn.pruning import PruneEventBus, PrunedEdgeEvent
from t_gnn.schema import Edge

try:
    import redis as redis_lib

    from t_gnn.motif_engine import RedisMotifStateStore
except ImportError:  # pragma: no cover
    redis_lib = None


def _edge(src, dst, edge_type="Authentication", protocol="Kerberos", t_e=0.0):
    return Edge(src=src, dst=dst, edge_type=edge_type, protocol=protocol, t_e=t_e, w_0=1.0)


_TWO_STEP = MotifDefinition(
    name="two_step",
    window_seconds=100.0,
    steps=(
        MotifStep(key_field="dst", src_type=frozenset({"Machine"}), dst_type=frozenset({"Machine"})),
        MotifStep(key_field="src", key_resolver="host_admin", src_type=frozenset({"User"}), dst_type=frozenset({"Machine"})),
    ),
)


def _engine(store=None, alert_bus=None, prune_event_bus=None, definitions=(_TWO_STEP,)):
    return MotifEngine(
        definitions=list(definitions),
        state_store=store or InMemoryMotifStateStore(),
        alert_bus=alert_bus,
        prune_event_bus=prune_event_bus,
    )


# --- delta-update: start / advance / complete (3.2/3.4) ------------------------


def test_step0_edge_creates_partial_state():
    store = InMemoryMotifStateStore()
    engine = _engine(store=store)

    engine.on_edge(_edge("Machine:A", "Machine:B", t_e=0.0))

    state = store.get("two_step", "Machine:B")
    assert state is not None
    assert state.stage == 1
    assert state.matched_edges[0]


def test_matching_second_hop_completes_motif():
    store = InMemoryMotifStateStore()
    events_seen = []
    alert_bus = MotifAlertBus()
    alert_bus.subscribe(events_seen.append)
    engine = _engine(store=store, alert_bus=alert_bus)

    engine.on_edge(_edge("Machine:A", "Machine:B", t_e=0.0))
    completion_events = engine.on_edge(
        _edge("User:B-admin", "Machine:C", edge_type="RemoteCodeExecution", t_e=50.0)
    )

    assert len(completion_events) == 1
    assert completion_events[0].motif_name == "two_step"
    assert completion_events[0].chain_key == "Machine:B"
    assert len(completion_events[0].matched_edges) == 2
    assert events_seen == completion_events
    assert store.get("two_step", "Machine:B") is None  # state cleared on completion


def test_unrelated_second_hop_shape_without_matching_key_is_ignored():
    store = InMemoryMotifStateStore()
    engine = _engine(store=store)

    engine.on_edge(_edge("Machine:A", "Machine:B", t_e=0.0))
    events = engine.on_edge(_edge("User:someone-else", "Machine:C", edge_type="Authentication", t_e=10.0))

    assert events == []
    assert store.get("two_step", "Machine:B").stage == 1  # untouched


def test_second_hop_with_no_prior_state_is_a_noop():
    store = InMemoryMotifStateStore()
    engine = _engine(store=store)

    events = engine.on_edge(_edge("User:B-admin", "Machine:C", edge_type="Authentication", t_e=0.0))

    assert events == []
    assert store.get("two_step", "Machine:B") is None


def test_starting_edge_does_not_clobber_in_progress_chain():
    store = InMemoryMotifStateStore()
    engine = _engine(store=store)

    engine.on_edge(_edge("Machine:A", "Machine:B", t_e=0.0))
    original = store.get("two_step", "Machine:B")
    engine.on_edge(_edge("Machine:A2", "Machine:B", t_e=1.0))  # another step0 edge, same key

    assert store.get("two_step", "Machine:B").matched_edges == original.matched_edges


def test_second_hop_older_than_first_hop_is_rejected():
    store = InMemoryMotifStateStore()
    engine = _engine(store=store)

    engine.on_edge(_edge("Machine:A", "Machine:B", t_e=100.0))
    events = engine.on_edge(
        _edge("User:B-admin", "Machine:C", edge_type="Authentication", t_e=10.0)  # earlier than the first hop
    )

    assert events == []
    assert store.get("two_step", "Machine:B").stage == 1


def test_second_hop_outside_window_drops_stale_state():
    store = InMemoryMotifStateStore()
    engine = _engine(store=store)

    engine.on_edge(_edge("Machine:A", "Machine:B", t_e=0.0))
    events = engine.on_edge(
        _edge("User:B-admin", "Machine:C", edge_type="Authentication", t_e=1000.0)  # window_seconds=100
    )

    assert events == []
    assert store.get("two_step", "Machine:B") is None


# --- TTL safety net, independent of explicit reset (3.7) ------------------------


def test_ttl_expires_state_independent_of_prune_events():
    now = [0.0]
    store = InMemoryMotifStateStore(clock=lambda: now[0])
    engine = _engine(store=store)

    engine.on_edge(_edge("Machine:A", "Machine:B", t_e=0.0))
    assert store.get("two_step", "Machine:B") is not None

    now[0] = 200.0  # past window_seconds=100's TTL
    assert store.get("two_step", "Machine:B") is None


# --- motif reset on prune (3.3/3.6) ----------------------------------------------


def test_on_prune_resets_dependent_partial_motif_state():
    store = InMemoryMotifStateStore()
    prune_bus = PruneEventBus()
    engine = _engine(store=store, prune_event_bus=prune_bus)

    engine.on_edge(_edge("Machine:A", "Machine:B", t_e=0.0))
    state = store.get("two_step", "Machine:B")
    contributing_edge = Edge(
        src="Machine:A", dst="Machine:B", edge_type="Authentication", protocol="Kerberos",
        t_e=0.0, w_0=1.0, edge_id=state.matched_edges[0],
    )

    prune_bus.publish(PrunedEdgeEvent(edge=contributing_edge, w_at_prune=0.001, pruned_at=5.0))

    assert store.get("two_step", "Machine:B") is None


def test_prune_of_unrelated_edge_does_not_reset_state():
    store = InMemoryMotifStateStore()
    prune_bus = PruneEventBus()
    engine = _engine(store=store, prune_event_bus=prune_bus)

    engine.on_edge(_edge("Machine:A", "Machine:B", t_e=0.0))
    unrelated = Edge(
        src="Machine:X", dst="Machine:Y", edge_type="Authentication", protocol="Kerberos", t_e=0.0, w_0=1.0,
    )

    prune_bus.publish(PrunedEdgeEvent(edge=unrelated, w_at_prune=0.001, pruned_at=5.0))

    assert store.get("two_step", "Machine:B") is not None


def test_prune_after_completion_is_a_noop():
    store = InMemoryMotifStateStore()
    prune_bus = PruneEventBus()
    engine = _engine(store=store, prune_event_bus=prune_bus)

    engine.on_edge(_edge("Machine:A", "Machine:B", t_e=0.0))
    completion_edge = _edge("User:B-admin", "Machine:C", edge_type="RemoteCodeExecution", t_e=50.0)
    events = engine.on_edge(completion_edge)

    prune_bus.publish(PrunedEdgeEvent(edge=completion_edge, w_at_prune=0.0, pruned_at=60.0))  # should not raise
    assert len(events) == 1


# --- end-to-end against the real seed motifs (3.8) -------------------------------


def test_seed_motifs_from_registry_end_to_end():
    registry = MotifRegistry()
    store = InMemoryMotifStateStore()
    alerts = []
    alert_bus = MotifAlertBus()
    alert_bus.subscribe(alerts.append)
    engine = MotifEngine(definitions=registry.all(), state_store=store, alert_bus=alert_bus)

    engine.on_edge(_edge("Machine:C1001", "Machine:C1042", edge_type="Authentication", protocol="Kerberos", t_e=0.0))
    engine.on_edge(
        Edge(
            src="User:C1042-admin", dst="Machine:C2000", edge_type="RemoteCodeExecution",
            protocol="RDP", t_e=3600.0, w_0=1.0,
        )
    )

    assert len(alerts) == 1
    assert alerts[0].motif_name == "lateral_pivot"
    assert alerts[0].chain_key == "Machine:C1042"


# --- live Redis integration (3.3, mirrors test_cold_storage.py's skip pattern) --


def _redis_reachable() -> bool:
    if redis_lib is None:
        return False
    try:
        client = redis_lib.Redis(host="localhost", port=6379, db=0, socket_connect_timeout=1)
        return client.ping()
    except Exception:
        return False


requires_redis = pytest.mark.skipif(
    not _redis_reachable(),
    reason="Redis not reachable at localhost:6379 -- run `docker compose up -d` first",
)


@requires_redis
def test_redis_state_store_round_trips_and_completes_motif():
    client = redis_lib.Redis(host="localhost", port=6379, db=0)
    store = RedisMotifStateStore(client)
    motif_name = f"itest-two-step-{id(object())}"
    definition = MotifDefinition(
        name=motif_name,
        window_seconds=100.0,
        steps=_TWO_STEP.steps,
    )
    try:
        engine = _engine(store=store, definitions=(definition,))
        engine.on_edge(_edge("Machine:A", "Machine:RB", t_e=0.0))

        state = store.get(motif_name, "Machine:RB")
        assert state is not None
        assert state.stage == 1

        events = engine.on_edge(
            _edge("User:RB-admin", "Machine:RC", edge_type="RemoteCodeExecution", t_e=10.0)
        )
        assert len(events) == 1
        assert store.get(motif_name, "Machine:RB") is None
    finally:
        client.delete(f"motif:state:{motif_name}:Machine:RB")


@requires_redis
def test_redis_state_store_reset_on_prune():
    client = redis_lib.Redis(host="localhost", port=6379, db=0)
    store = RedisMotifStateStore(client)
    motif_name = f"itest-reset-{id(object())}"
    definition = MotifDefinition(name=motif_name, window_seconds=100.0, steps=_TWO_STEP.steps)
    prune_bus = PruneEventBus()
    try:
        engine = _engine(store=store, definitions=(definition,), prune_event_bus=prune_bus)
        edge = _edge("Machine:A", "Machine:RB2", t_e=0.0)
        engine.on_edge(edge)
        assert store.get(motif_name, "Machine:RB2") is not None

        prune_bus.publish(PrunedEdgeEvent(edge=edge, w_at_prune=0.001, pruned_at=1.0))

        assert store.get(motif_name, "Machine:RB2") is None
    finally:
        client.delete(f"motif:state:{motif_name}:Machine:RB2")
