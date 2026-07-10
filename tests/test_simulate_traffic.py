import random

from t_gnn.baseline import BaselineStore
from t_gnn.data.simulate_traffic import (
    generate_background_traffic,
    inject_admin_share_escalation,
    inject_lateral_pivot,
    inject_low_and_slow_anomaly,
    simulate,
    write_redteam_labels,
    write_staged_shards,
)
from t_gnn.decay import DecayEngine
from t_gnn.motif_engine import InMemoryMotifStateStore, MotifEngine
from t_gnn.motifs import MotifRegistry
from t_gnn.pilot import load_redteam_labels, run_pilot
from t_gnn.schema import Edge

_EPOCH = 1_451_606_400


# --- generate_background_traffic --------------------------------------------------


def test_background_traffic_is_reproducible_with_same_seed():
    edges_a = generate_background_traffic(random.Random(7), num_users=10, num_machines=5, duration_seconds=86400.0)
    edges_b = generate_background_traffic(random.Random(7), num_users=10, num_machines=5, duration_seconds=86400.0)

    assert [e.to_json() for e in edges_a] == [e.to_json() for e in edges_b]


def test_background_traffic_produces_only_user_to_machine_authentication_edges():
    edges = generate_background_traffic(random.Random(1), num_users=5, num_machines=3, duration_seconds=86400.0)

    assert edges  # sanity: something was generated
    for edge in edges:
        assert edge.src_type == "User"
        assert edge.dst_type == "Machine"
        assert edge.edge_type == "Authentication"


# --- inject_lateral_pivot completes the real seed motif ---------------------------


def test_inject_lateral_pivot_completes_the_seed_motif():
    rng = random.Random(3)
    machines = [f"C{1000+i}" for i in range(10)]
    edges, labels = inject_lateral_pivot(rng, machines, t_start=_EPOCH)

    assert len(edges) == 2
    assert len(labels) == 1

    motif_engine = MotifEngine(definitions=MotifRegistry().all(), state_store=InMemoryMotifStateStore())
    completions = []
    for edge in edges:
        completions.extend(motif_engine.on_edge(edge))

    assert len(completions) == 1
    assert completions[0].motif_name == "lateral_pivot"
    assert completions[0].chain_key == f"Machine:{edges[0].dst.split(':')[1]}"


# --- inject_admin_share_escalation completes the real seed motif -----------------


def test_inject_admin_share_escalation_completes_the_seed_motif():
    rng = random.Random(5)
    machines = [f"C{1000+i}" for i in range(10)]
    edges, labels = inject_admin_share_escalation(rng, num_users=10, machines=machines, t_start=_EPOCH)

    assert len(edges) == 2
    assert len(labels) == 1

    motif_engine = MotifEngine(definitions=MotifRegistry().all(), state_store=InMemoryMotifStateStore())
    completions = []
    for edge in edges:
        completions.extend(motif_engine.on_edge(edge))

    assert len(completions) == 1
    assert completions[0].motif_name == "admin_share_escalation"


# --- inject_low_and_slow_anomaly is flagged by baseline deviation ----------------


def test_inject_low_and_slow_anomaly_is_flagged_after_established_history():
    rng = random.Random(9)
    machines = [f"C{1000+i}" for i in range(5)]
    background = generate_background_traffic(rng, num_users=5, num_machines=5, duration_seconds=7 * 86400.0)
    anomaly_edge, label = inject_low_and_slow_anomaly(rng, num_users=5, machines=machines, t=_EPOCH + 6 * 86400.0)

    edges = sorted(background + [anomaly_edge], key=lambda e: e.t_e)
    decay = DecayEngine()
    baseline = BaselineStore()
    signals = [baseline.observe_edge(decay.refresh(e, e.t_e)) for e in edges]

    matching = [s for s in signals if s.entity == f"User:{label.user}" and abs(s.t - label.t) < 1.0]
    assert len(matching) == 1
    assert matching[0].z_score is not None
    assert abs(matching[0].z_score) >= 3.0


# --- write_staged_shards / write_redteam_labels round-trip -----------------------


def test_write_staged_shards_round_trips_via_edge_from_json(tmp_path):
    edges = generate_background_traffic(random.Random(2), num_users=3, num_machines=2, duration_seconds=86400.0)
    staged_dir = tmp_path / "staged"

    write_staged_shards(edges, staged_dir, shard_size=1000)

    read_back = []
    for shard in sorted(staged_dir.glob("shard-*.jsonl")):
        for line in shard.read_text(encoding="utf-8").splitlines():
            read_back.append(Edge.from_json(line))

    assert len(read_back) == len(edges)
    assert {e.edge_id for e in read_back} == {e.edge_id for e in edges}


def test_write_and_load_redteam_labels_round_trip(tmp_path):
    rng = random.Random(11)
    machines = [f"C{1000+i}" for i in range(10)]
    _, labels = inject_lateral_pivot(rng, machines, t_start=_EPOCH + 100.0)
    path = tmp_path / "redteam.txt"

    write_redteam_labels(labels, path, epoch_start=_EPOCH)
    loaded = load_redteam_labels(path, epoch_start=_EPOCH)

    assert len(loaded) == len(labels)
    assert loaded[0].user == labels[0].user
    assert loaded[0].source_computer == labels[0].source_computer
    assert loaded[0].destination_computer == labels[0].destination_computer
    assert abs(loaded[0].t - labels[0].t) < 1.0  # sub-second rounding from the integer-offset format


# --- simulate() end-to-end, scored through the real pilot harness ---------------


def test_simulate_end_to_end_scores_cleanly_through_the_pilot_harness():
    edges, labels = simulate(
        seed=42, num_users=30, num_machines=15, duration_seconds=7 * 86400.0,
        events_per_user_per_day=3.0, num_lateral_pivots=3, num_admin_share_escalations=3, num_anomalies=3,
    )
    edges = sorted(edges, key=lambda e: e.t_e)
    assert len(labels) == 9  # 3 + 3 + 3 injected attacks

    decay = DecayEngine()
    baseline = BaselineStore()
    motif_engine = MotifEngine(definitions=MotifRegistry().all(), state_store=InMemoryMotifStateStore())

    signals = []
    completions = []
    for edge in edges:
        refreshed = decay.refresh(edge, edge.t_e)
        signals.append(baseline.observe_edge(refreshed))
        completions.extend(motif_engine.on_edge(edge))

    report = run_pilot(signals, completions, labels)

    # Motif detection: background traffic structurally can't produce a
    # Machine->Machine, User->User, or FileTransfer edge (see
    # generate_background_traffic), so every completion is provably one of
    # the 6 injected motif attacks -- no collision is possible.
    assert report.motif.true_positives == 6
    assert report.motif.false_positives == 0

    # Anomaly detection: all 3 injected low-and-slow events get flagged
    # (each target user has established baseline variance by injection
    # time); some background noise (rare failed logons vs. a tight
    # baseline) also crosses the z-threshold, which is realistic pilot
    # signal, not a bug -- only asserted as a lower bound here.
    assert report.anomaly.true_positives == 3
