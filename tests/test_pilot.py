from pathlib import Path

from t_gnn.baseline import BaselineStore, DeviationSignal
from t_gnn.data.stage_lanl import DEFAULT_EPOCH_START, stage
from t_gnn.decay import DecayEngine
from t_gnn.motif_engine import InMemoryMotifStateStore, MotifCompletionEvent, MotifEngine
from t_gnn.motifs import MotifRegistry
from t_gnn.pilot import (
    RedTeamLabel,
    evaluate_anomaly_detection,
    evaluate_motif_detection,
    load_redteam_labels,
    run_pilot,
)
from t_gnn.schema import Edge

_SAMPLE_LANL_FIXTURE = Path(__file__).resolve().parents[1] / "data" / "lanl" / "raw" / "sample_auth.txt.gz"
_SAMPLE_REDTEAM_FIXTURE = Path(__file__).resolve().parents[1] / "data" / "lanl" / "raw" / "sample_redteam.txt"


def _signal(entity, z_score, t=0.0):
    return DeviationSignal(entity=entity, protocol="RDP", t=t, value=1.0, baseline_mean=1.0, baseline_std=0.1, sample_count=5, z_score=z_score)


def _completion(chain_key, completed_at, motif_name="lateral_pivot"):
    return MotifCompletionEvent(motif_name=motif_name, chain_key=chain_key, matched_edges=["e1", "e2"], completed_at=completed_at)


# --- load_redteam_labels -----------------------------------------------------------


def test_load_redteam_labels_parses_rows_and_anchors_time(tmp_path):
    path = tmp_path / "redteam.txt"
    path.write_text("100,mallory@CORP,C1,C2\n", encoding="utf-8")

    labels = load_redteam_labels(path, epoch_start=1000)

    assert len(labels) == 1
    label = labels[0]
    assert label.t == 1100.0
    assert label.user == "mallory"
    assert label.source_computer == "C1"
    assert label.destination_computer == "C2"
    assert label.entity_id == "User:mallory"


def test_load_redteam_labels_skips_malformed_rows(tmp_path):
    path = tmp_path / "redteam.txt"
    path.write_text("100,mallory@CORP,C1,C2\nincomplete,row\n", encoding="utf-8")

    labels = load_redteam_labels(path, epoch_start=0)

    assert len(labels) == 1


# --- evaluate_anomaly_detection ------------------------------------------------------


def test_anomaly_detection_true_positive_within_threshold_and_tolerance():
    labels = [RedTeamLabel(t=100.0, user="mallory", source_computer="C1", destination_computer="C2")]
    signals = [_signal("User:mallory", z_score=5.0, t=110.0)]

    metrics = evaluate_anomaly_detection(signals, labels, z_threshold=3.0, time_tolerance_seconds=60.0)

    assert metrics.true_positives == 1
    assert metrics.false_positives == 0
    assert metrics.false_negatives == 0
    assert metrics.precision == 1.0
    assert metrics.recall == 1.0


def test_anomaly_detection_false_negative_when_no_signal_flags_the_label():
    labels = [RedTeamLabel(t=100.0, user="mallory", source_computer="C1", destination_computer="C2")]

    metrics = evaluate_anomaly_detection(signals=[], labels=labels)

    assert metrics.true_positives == 0
    assert metrics.false_negatives == 1
    assert metrics.recall == 0.0
    assert metrics.precision is None  # 0/0 -- no positive predictions were made at all


def test_anomaly_detection_false_positive_when_signal_flags_unlabeled_entity():
    labels = [RedTeamLabel(t=100.0, user="mallory", source_computer="C1", destination_computer="C2")]
    signals = [_signal("User:alice", z_score=10.0, t=100.0)]  # unrelated entity, high z-score

    metrics = evaluate_anomaly_detection(signals, labels)

    assert metrics.true_positives == 0
    assert metrics.false_positives == 1
    assert metrics.false_negatives == 1
    assert metrics.precision == 0.0


def test_anomaly_detection_ignores_signal_below_z_threshold():
    labels = [RedTeamLabel(t=100.0, user="mallory", source_computer="C1", destination_computer="C2")]
    signals = [_signal("User:mallory", z_score=1.0, t=100.0)]  # below default threshold of 3.0

    metrics = evaluate_anomaly_detection(signals, labels, z_threshold=3.0)

    assert metrics.true_positives == 0
    assert metrics.false_positives == 0  # never flagged, so not a false alarm either
    assert metrics.false_negatives == 1


def test_anomaly_detection_ignores_signal_outside_time_tolerance():
    labels = [RedTeamLabel(t=100.0, user="mallory", source_computer="C1", destination_computer="C2")]
    signals = [_signal("User:mallory", z_score=10.0, t=100.0 + 7200.0)]  # 2h away, tolerance is 1h default

    metrics = evaluate_anomaly_detection(signals, labels, time_tolerance_seconds=3600.0)

    assert metrics.true_positives == 0
    assert metrics.false_positives == 1  # flagged, but didn't land near any label
    assert metrics.false_negatives == 1


def test_anomaly_detection_ignores_signal_with_none_z_score():
    labels = [RedTeamLabel(t=100.0, user="mallory", source_computer="C1", destination_computer="C2")]
    signals = [_signal("User:mallory", z_score=None, t=100.0)]

    metrics = evaluate_anomaly_detection(signals, labels)

    assert metrics.true_positives == 0
    assert metrics.false_positives == 0


# --- evaluate_motif_detection ---------------------------------------------------------


def test_motif_detection_true_positive_matches_chain_key_and_window():
    labels = [RedTeamLabel(t=100.0, user="mallory", source_computer="C1", destination_computer="C2")]
    completions = [_completion(chain_key="Machine:C2", completed_at=200.0)]

    metrics = evaluate_motif_detection(completions, labels, time_tolerance_seconds=200.0)

    assert metrics.true_positives == 1
    assert metrics.false_positives == 0
    assert metrics.false_negatives == 0


def test_motif_detection_false_positive_and_false_negative():
    labels = [RedTeamLabel(t=100.0, user="mallory", source_computer="C1", destination_computer="C2")]
    completions = [_completion(chain_key="Machine:unrelated", completed_at=100.0)]

    metrics = evaluate_motif_detection(completions, labels)

    assert metrics.true_positives == 0
    assert metrics.false_positives == 1
    assert metrics.false_negatives == 1


# --- run_pilot combines both -----------------------------------------------------------


def test_run_pilot_combines_anomaly_and_motif_reports():
    labels = [RedTeamLabel(t=100.0, user="mallory", source_computer="C1", destination_computer="C2")]
    signals = [_signal("User:mallory", z_score=5.0, t=100.0)]
    completions = [_completion(chain_key="Machine:C2", completed_at=100.0)]

    report = run_pilot(signals, completions, labels)

    assert report.anomaly.true_positives == 1
    assert report.motif.true_positives == 1


# --- end-to-end smoke test against the tiny sample LANL fixture (7.3) -----------------


def test_pilot_smoke_test_against_sample_lanl_fixture(tmp_path):
    """Mirrors calibrate_decay.py's own disclaimer: this exercises the
    harness mechanically end-to-end against real staged LANL data + a
    real-format redteam label, but 5 rows of synthetic traffic isn't a
    validated pilot result -- mallory's single labeled event has no prior
    baseline history (BaselineStore needs >=2 samples for a z-score at
    all), so a correctly-behaving harness reports it as a miss, not a hit.
    That's the honest outcome to assert, not a false claim of detection.
    """
    staged_dir = tmp_path / "staged"
    stats = stage(_SAMPLE_LANL_FIXTURE, staged_dir)
    assert stats.edges_written > 0

    edges = []
    for shard in sorted(staged_dir.glob("shard-*.jsonl")):
        for line in shard.read_text(encoding="utf-8").splitlines():
            edges.append(Edge.from_json(line))
    edges.sort(key=lambda e: e.t_e)

    labels = load_redteam_labels(_SAMPLE_REDTEAM_FIXTURE, epoch_start=DEFAULT_EPOCH_START)
    assert len(labels) == 1

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

    assert report.anomaly.false_negatives == 1  # mallory's lone event never had enough history for a z-score
    assert report.anomaly.true_positives == 0
    assert report.motif.false_negatives == 1  # the fixture has no Machine->Machine hop for either seed motif
    assert report.motif.false_positives == 0  # and no spurious completions fired either
