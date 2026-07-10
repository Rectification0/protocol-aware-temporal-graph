"""Phase 5 end-to-end tests (tasks.md 5.4/5.5)."""

from pathlib import Path

from t_gnn.data.stage_lanl import stage
from t_gnn.graph_store import ActiveGraphStore
from t_gnn.motif_engine import InMemoryMotifStateStore, MotifAlertBus, MotifEngine
from t_gnn.motifs import MotifDefinition, MotifStep
from t_gnn.pruning import PruneEventBus
from t_gnn.schema import Edge
from t_gnn.streaming import DecayStreamProcessor
from t_gnn.tgnn import InferenceResultBus, TGNNInferenceEngine

_SAMPLE_LANL_FIXTURE = Path(__file__).resolve().parents[1] / "data" / "lanl" / "raw" / "sample_auth.txt.gz"


# --- 5.4: LANL replay as a "low and slow" APT scenario, detected via baseline deviation ---


def test_lanl_replay_low_and_slow_apt_detected_via_baseline_deviation(tmp_path):
    """Replays the staged LANL fixture (task 0.4) as ordinary background
    traffic, then layers a synthetic "low and slow" tail onto one of its
    entities: a run of normal-looking logons followed by one sharply
    heavier-weighted event. Confirms FR1.5's baseline-deviation signal
    flags the tail's final event, end-to-end from real staged edges through
    DecayStreamProcessor into the T-GNN inference engine (5.2's feature
    wiring)."""
    staged_dir = tmp_path / "staged"
    stats = stage(_SAMPLE_LANL_FIXTURE, staged_dir)
    assert stats.edges_written > 0

    staged_edges = []
    for shard in sorted(staged_dir.glob("shard-*.jsonl")):
        for line in shard.read_text(encoding="utf-8").splitlines():
            staged_edges.append(Edge.from_json(line))
    staged_edges.sort(key=lambda e: e.t_e)

    processor = DecayStreamProcessor()
    for edge in staged_edges:
        processor.process(edge, t=edge.t_e)

    # "Low and slow" APT tail: alice's account, already seeded by the LANL
    # replay above, quietly authenticates like clockwork for days -- then
    # one login carries a much heavier initial weight (e.g. an unusual
    # admin-scoped session) that a point-in-time detector would still miss
    # in isolation, but which stands out against her now-established
    # baseline.
    apt_entity = "User:alice"
    base_t = max(e.t_e for e in staged_edges) + 3600.0
    last_deviation = None
    for i in range(8):
        normal_edge = Edge(
            src=apt_entity, dst="Machine:C1042", edge_type="Authentication",
            protocol="Kerberos", t_e=base_t + i * 86400.0, w_0=1.0 + (0.01 if i % 2 else -0.01),
        )
        last_deviation = processor.process(normal_edge, t=normal_edge.t_e).deviation

    anomalous_edge = Edge(
        src=apt_entity, dst="Machine:C9999-domain-controller", edge_type="Authentication",
        protocol="Kerberos", t_e=base_t + 8 * 86400.0, w_0=9.0,
    )
    anomalous_result = processor.process(anomalous_edge, t=anomalous_edge.t_e)

    assert last_deviation.z_score is not None
    assert abs(last_deviation.z_score) < 3.0  # the normal tail stayed unremarkable

    assert anomalous_result.deviation.z_score is not None
    assert abs(anomalous_result.deviation.z_score) > 3.0  # the injected event stands out

    # 5.2: the deviation signal is wired into the T-GNN as an input feature,
    # not just a standalone statistic.
    store = ActiveGraphStore()
    store.upsert(anomalous_result.edge)
    engine = TGNNInferenceEngine(store=store)
    engine.observe_deviation(anomalous_result.deviation)

    results = engine.run_once(t=anomalous_edge.t_e)
    assert any(r.entity_id == apt_entity for r in results)


# --- 5.5: synthetic motif-matching attack sequence -> completion alert -> fast-path inference ---


def test_synthetic_lateral_pivot_attack_fires_alert_and_triggers_fast_path_inference():
    """Injects the canonical two-hop lateral-pivot sequence (specs.md
    FR3.1/§1.1) and confirms both halves of the chain fire correctly:
    the motif-completion alert (3.5), and that alert immediately
    triggering a targeted T-GNN inference pass over the local
    neighborhood (5.3) rather than waiting for a scheduled cycle."""
    lateral_pivot = MotifDefinition(
        name="lateral_pivot",
        window_seconds=14400.0,
        steps=(
            MotifStep(key_field="dst", src_type=frozenset({"Machine"}), dst_type=frozenset({"Machine"}),
                      edge_type=frozenset({"Authentication"})),
            MotifStep(key_field="src", key_resolver="host_admin", src_type=frozenset({"User"}),
                      dst_type=frozenset({"Machine"}),
                      edge_type=frozenset({"Authentication", "RemoteCodeExecution"})),
        ),
    )

    store = ActiveGraphStore()
    prune_bus = PruneEventBus()
    motif_alert_bus = MotifAlertBus()
    inference_result_bus = InferenceResultBus()

    motif_engine = MotifEngine(
        definitions=[lateral_pivot], state_store=InMemoryMotifStateStore(),
        alert_bus=motif_alert_bus, prune_event_bus=prune_bus,
    )
    inference_engine = TGNNInferenceEngine(
        store=store, result_bus=inference_result_bus, alert_bus=motif_alert_bus,
    )
    triggered = []
    inference_result_bus.subscribe(triggered.append)

    hop1 = Edge(src="Machine:C2001", dst="Machine:C2042", edge_type="Authentication",
                protocol="Kerberos", t_e=0.0, w_0=1.0)
    hop2 = Edge(src="User:C2042-admin", dst="Machine:C3000", edge_type="RemoteCodeExecution",
                protocol="RDP", t_e=3600.0, w_0=1.0)

    store.upsert(hop1)
    completions = motif_engine.on_edge(hop1)
    assert completions == []  # only the first hop so far -- no alert yet

    store.upsert(hop2)
    completions = motif_engine.on_edge(hop2)

    assert len(completions) == 1
    assert completions[0].motif_name == "lateral_pivot"
    assert completions[0].chain_key == "Machine:C2042"

    # The alert firing (3.5) should have already driven the fast-path
    # trigger (5.3) via the shared MotifAlertBus, with no extra wiring.
    assert triggered
    assert all(r.trigger == "motif_completion" and r.motif_name == "lateral_pivot" for r in triggered)
    assert "Machine:C2042" in {r.entity_id for r in triggered}
