"""Chaos/failure testing (tasks.md 6.5): verifies the four mitigations in
design.md §5's Failure Modes table actually hold under a simulated fault,
one test per table row."""

import time

from redis.exceptions import ConnectionError as RedisConnectionError

from t_gnn.audit import AuditLogger, InMemoryAuditSink
from t_gnn.baseline import BaselineStore
from t_gnn.cold_storage import BufferedColdStorageWriter, InMemoryColdStorageWriter
from t_gnn.decay import DecayEngine
from t_gnn.graph_store import ActiveGraphStore
from t_gnn.motif_engine import MotifEngine
from t_gnn.motifs import MotifDefinition, MotifStep
from t_gnn.protocol_registry import ProtocolDecayRegistry
from t_gnn.pruning import EpsilonController, PruneEventBus, PruningWatcher
from t_gnn.schema import Edge


def _edge(src, dst, edge_type="Authentication", protocol="RDP", t_e=0.0, w_0=1.0):
    return Edge(src=src, dst=dst, edge_type=edge_type, protocol=protocol, t_e=t_e, w_0=w_0)


# --- Row 1: "Flink backpressure during log spikes" -> backpressure-aware epsilon tightening ---


def test_ingest_spike_triggers_epsilon_tightening_then_relaxes_once_calm():
    store = ActiveGraphStore()
    controller = EpsilonController(epsilon_min=0.01, epsilon_max=0.99, max_edges=200)
    watcher = PruningWatcher(
        store=store, decay_engine=DecayEngine(), epsilon_controller=controller,
        cold_storage=InMemoryColdStorageWriter(), memory_probe=lambda: None,
    )

    # A burst of 1000 edges arrives before any prune pass has run -- more
    # volume than the configured 200-edge ceiling, standing in for "Flink
    # backpressure during a log spike" (no real Flink job exists to
    # generate literal backpressure). DNS's slow decay means w(e,t) alone
    # wouldn't cross even epsilon_min on this timescale, isolating
    # size-pressure-driven tightening from time-decay-driven pruning.
    for i in range(1000):
        store.upsert(_edge(f"Machine:spike-{i}", f"Machine:target-{i}", protocol="DNS", w_0=0.5))
    assert len(store) == 1000  # the burst outran pruning entirely

    spike_stats = watcher.run_once(t=1.0)

    assert spike_stats.epsilon > 0.9  # size pressure alone drove epsilon toward epsilon_max
    assert len(store) < 200  # tightened epsilon brought the store back under the configured ceiling

    calm_stats = watcher.run_once(t=2.0)  # no further ingest -- pressure has relaxed

    assert calm_stats.epsilon < spike_stats.epsilon  # "as usage falls, epsilon relaxes" (design.md 2.5)


# --- Row 2: "Redis unavailable" -> motif detection disabled, anomaly detection unaffected ---


class _OutageStateStore:
    """Every call raises, simulating a Redis instance that's simply gone."""

    def get(self, motif_name, chain_key):
        raise RedisConnectionError("simulated redis outage")

    def set(self, state, ttl_seconds):
        raise RedisConnectionError("simulated redis outage")

    def delete(self, motif_name, chain_key):
        raise RedisConnectionError("simulated redis outage")

    def states_containing_edge(self, edge_id):
        raise RedisConnectionError("simulated redis outage")


def test_redis_outage_disables_motif_detection_without_affecting_anomaly_detection():
    lateral_pivot = MotifDefinition(
        name="lateral_pivot",
        window_seconds=14400.0,
        steps=(
            MotifStep(key_field="dst", src_type=frozenset({"Machine"}), dst_type=frozenset({"Machine"})),
            MotifStep(key_field="src", key_resolver="host_admin", src_type=frozenset({"User"}), dst_type=frozenset({"Machine"})),
        ),
    )
    motif_engine = MotifEngine(definitions=[lateral_pivot], state_store=_OutageStateStore())
    baseline = BaselineStore()
    decay = DecayEngine()

    hop1 = _edge("Machine:C1", "Machine:C2", protocol="Kerberos", t_e=0.0)
    hop2 = _edge("User:C2-admin", "Machine:C3", edge_type="RemoteCodeExecution", protocol="RDP", t_e=3600.0)

    completions = motif_engine.on_edge(hop1) + motif_engine.on_edge(hop2)

    assert completions == []  # motif detection is silently disabled, not crashed
    assert motif_engine.available is False

    # FR1.5 anomaly detection has zero architectural dependency on Redis --
    # run it against the exact same edges and confirm it's unaffected.
    for edge, t in [(hop1, 0.0), (hop2, 3600.0)]:
        refreshed = decay.refresh(edge, t)
        signal = baseline.observe_edge(refreshed)
        assert signal is not None


# --- Row 3: "Neo4j write latency spike" -> buffering keeps pruning from stalling ---


class _IntermittentlySlowWriter:
    """Every third write hits a simulated latency spike; the rest are fast."""

    def __init__(self, slow_seconds: float = 0.5) -> None:
        self.calls = 0
        self.written: list[Edge] = []
        self.slow_seconds = slow_seconds

    def write(self, edge, w_at_prune, pruned_at):
        self.calls += 1
        if self.calls % 3 == 0:
            time.sleep(self.slow_seconds)
        self.written.append(edge)


def test_neo4j_intermittent_latency_spikes_do_not_stall_pruning_and_all_writes_eventually_land():
    store = ActiveGraphStore()
    for i in range(9):
        store.upsert(_edge(f"Machine:A{i}", f"Machine:B{i}"))

    slow_writer = _IntermittentlySlowWriter(slow_seconds=0.5)
    buffered = BufferedColdStorageWriter(slow_writer)
    buffered.start()
    try:
        watcher = PruningWatcher(
            store=store, decay_engine=DecayEngine(),
            epsilon_controller=EpsilonController(epsilon_min=0.9, epsilon_max=0.9),
            cold_storage=buffered,
        )

        started = time.time()
        stats = watcher.run_once(t=3600.0 * 10)
        elapsed = time.time() - started

        assert stats.pruned == 9
        assert elapsed < 0.5  # run_once() itself never waits on any of the slow writes

        deadline = time.time() + 5.0
        while time.time() < deadline and len(slow_writer.written) < 9:
            time.sleep(0.05)
        assert len(slow_writer.written) == 9  # all 9 eventually land despite the intermittent spikes
        assert buffered.dropped == 0
    finally:
        buffered.stop(timeout=5.0)


# --- Row 4: "Incorrect lambda_p" -> hot-reload correction + audit log surfaces the anomaly ---


def test_misconfigured_lambda_p_prune_spike_is_visible_in_audit_log_then_hot_reload_fixes_it(tmp_path):
    config_path = tmp_path / "protocols.yaml"
    config_path.write_text(
        "default_lambda_p: 0.0000198\n"
        "protocols:\n"
        "  RDP:\n"
        "    lambda_p: 0.05\n"  # misconfigured: ~100x too aggressive vs. the real ~0.0001925 (task 0.3)
        "    description: accidentally aggressive\n",
        encoding="utf-8",
    )
    registry = ProtocolDecayRegistry(config_path=config_path)
    decay = DecayEngine(registry=registry)

    store = ActiveGraphStore()
    for i in range(20):
        store.upsert(_edge(f"Machine:A{i}", f"Machine:B{i}", t_e=0.0))

    prune_bus = PruneEventBus()
    audit_sink = InMemoryAuditSink()
    AuditLogger(audit_sink, prune_bus=prune_bus)
    watcher = PruningWatcher(
        store=store, decay_engine=decay,
        epsilon_controller=EpsilonController(epsilon_min=0.3, epsilon_max=0.3),
        cold_storage=InMemoryColdStorageWriter(), event_bus=prune_bus,
    )

    misconfigured_stats = watcher.run_once(t=60.0)  # just one minute later

    assert misconfigured_stats.pruned == 20  # the whole batch got wiped out almost immediately
    prune_records = [r for r in audit_sink.records if r["type"] == "prune"]
    assert len(prune_records) == 20  # NFR5: the anomaly is fully visible/countable in the audit log

    # An operator, having noticed the abnormal prune rate via the audit
    # log, corrects the config and hot-reloads it -- no redeploy (FR1.3,
    # design.md 2.2, tasks.md 1.2).
    config_path.write_text(
        "default_lambda_p: 0.0000198\n"
        "protocols:\n"
        "  RDP:\n"
        "    lambda_p: 0.0001925\n"
        "    description: corrected\n",
        encoding="utf-8",
    )
    registry.reload()

    for i in range(20):
        store.upsert(_edge(f"Machine:C{i}", f"Machine:D{i}", t_e=60.0))

    corrected_stats = watcher.run_once(t=120.0)  # another minute later, with corrected lambda_p

    assert corrected_stats.pruned == 0  # the corrected decay constant no longer wipes out fresh edges
