"""Pilot evaluation harness (tasks.md 7.3).

7.3 asks to "pilot deployment against a subset of enterprise log traffic;
validate false-positive/negative rates before full rollout." The actual
pilot -- running this against real, labeled enterprise traffic, and using
its results to make a go/no-go rollout call -- is an operational step this
repo can't perform: there's no live enterprise deployment, and the real
LANL Comprehensive Cybersecurity dataset's `redteam.txt` ground truth isn't
vendored here any more than `auth.txt.gz` itself is (task 0.4's own
disclaimer). What this module implements is the *harness* a real pilot
would run: given detector output (FR1.5 deviation signals, FR3.4 motif
completions) and labeled ground-truth malicious activity, compute the
false-positive/negative rates 7.3 asks for.

`data/lanl/raw/sample_redteam.txt` is a tiny synthetic label file in the
real dataset's `redteam.txt` format, letting tests exercise the mechanism
end-to-end -- a smoke test of the harness, not a validated pilot result,
the same disclaimer `calibrate_decay.py` (task 1.7) makes about its own
tiny fixture.
"""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Optional

from t_gnn.baseline import BaselineStore, DeviationSignal
from t_gnn.data.stage_lanl import DEFAULT_EPOCH_START
from t_gnn.decay import DecayEngine
from t_gnn.motif_engine import InMemoryMotifStateStore, MotifCompletionEvent, MotifEngine
from t_gnn.motifs import MotifRegistry
from t_gnn.schema import Edge

REDTEAM_COLUMNS = ("time", "user", "source_computer", "destination_computer")


@dataclass(frozen=True)
class RedTeamLabel:
    """One row of LANL's `redteam.txt` ground truth: a known-malicious
    authentication event (design.md 2.9's "known-labeled red-team
    activity")."""

    t: float
    user: str
    source_computer: str
    destination_computer: str

    @property
    def entity_id(self) -> str:
        return f"User:{self.user}"


def load_redteam_labels(path: Path, epoch_start: int = DEFAULT_EPOCH_START) -> list[RedTeamLabel]:
    """Parses LANL's `redteam.txt` format with the same relative-time
    anchoring convention `stage_lanl.py` uses for `auth.txt.gz` (task 0.4)
    -- `epoch_start` must match whatever was used to stage the
    corresponding `auth.txt.gz` for the timestamps to line up."""
    labels: list[RedTeamLabel] = []
    with open(path, "r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        for row in reader:
            if len(row) < len(REDTEAM_COLUMNS):
                continue
            record = dict(zip(REDTEAM_COLUMNS, row))
            user = record["user"].split("@")[0]
            labels.append(RedTeamLabel(
                t=float(epoch_start + int(record["time"])),
                user=user,
                source_computer=record["source_computer"],
                destination_computer=record["destination_computer"],
            ))
    return labels


@dataclass
class DetectionMetrics:
    true_positives: int
    false_positives: int
    false_negatives: int
    precision: Optional[float]
    recall: Optional[float]


def _ratio(numerator: int, denominator: int) -> Optional[float]:
    return numerator / denominator if denominator else None


@dataclass
class PilotReport:
    anomaly: DetectionMetrics
    motif: DetectionMetrics


def evaluate_anomaly_detection(
    signals: Iterable[DeviationSignal],
    labels: Iterable[RedTeamLabel],
    z_threshold: float = 3.0,
    time_tolerance_seconds: float = 3600.0,
) -> DetectionMetrics:
    """FR1.5's deviation signal vs. ground truth: a signal counts as
    detecting a label if it's for the same entity, its z-score magnitude
    reaches `z_threshold`, and it falls within `time_tolerance_seconds` of
    the labeled event. A flagged signal matching no label is a false
    positive; a label matched by no signal is a false negative."""
    labels = list(labels)
    flagged = [s for s in signals if s.z_score is not None and abs(s.z_score) >= z_threshold]

    matched_labels: set[int] = set()
    false_positives = 0
    for signal in flagged:
        hit = False
        for i, label in enumerate(labels):
            if label.entity_id == signal.entity and abs(signal.t - label.t) <= time_tolerance_seconds:
                matched_labels.add(i)
                hit = True
        if not hit:
            false_positives += 1

    true_positives = len(matched_labels)
    false_negatives = len(labels) - true_positives
    return DetectionMetrics(
        true_positives=true_positives,
        false_positives=false_positives,
        false_negatives=false_negatives,
        precision=_ratio(true_positives, true_positives + false_positives),
        recall=_ratio(true_positives, true_positives + false_negatives),
    )


def evaluate_motif_detection(
    completions: Iterable[MotifCompletionEvent],
    labels: Iterable[RedTeamLabel],
    time_tolerance_seconds: float = 14400.0,
) -> DetectionMetrics:
    """FR3.4's motif-completion alert vs. ground truth: a completion
    counts as detecting a label if the completion's `chain_key` (motifs.py
    -- the entity the whole match pivots on) equals the label's source or
    destination computer (the `lateral_pivot` shape, whose chain key is a
    Machine) *or* the label's user (the `admin_share_escalation` shape,
    whose chain key is the service-account User) within
    `time_tolerance_seconds`."""
    labels = list(labels)
    completions = list(completions)

    matched_labels: set[int] = set()
    false_positives = 0
    for event in completions:
        hit = False
        for i, label in enumerate(labels):
            candidates = {
                f"Machine:{label.source_computer}",
                f"Machine:{label.destination_computer}",
                f"User:{label.user}",
            }
            if event.chain_key in candidates and abs(event.completed_at - label.t) <= time_tolerance_seconds:
                matched_labels.add(i)
                hit = True
        if not hit:
            false_positives += 1

    true_positives = len(matched_labels)
    false_negatives = len(labels) - true_positives
    return DetectionMetrics(
        true_positives=true_positives,
        false_positives=false_positives,
        false_negatives=false_negatives,
        precision=_ratio(true_positives, true_positives + false_positives),
        recall=_ratio(true_positives, true_positives + false_negatives),
    )


def run_pilot(
    signals: Iterable[DeviationSignal],
    completions: Iterable[MotifCompletionEvent],
    labels: Iterable[RedTeamLabel],
    z_threshold: float = 3.0,
    anomaly_time_tolerance_seconds: float = 3600.0,
    motif_time_tolerance_seconds: float = 14400.0,
) -> PilotReport:
    labels = list(labels)
    return PilotReport(
        anomaly=evaluate_anomaly_detection(signals, labels, z_threshold, anomaly_time_tolerance_seconds),
        motif=evaluate_motif_detection(completions, labels, motif_time_tolerance_seconds),
    )


def _replay_staged_edges(staged_dir: Path) -> list[Edge]:
    edges = []
    for shard in sorted(staged_dir.glob("shard-*.jsonl")):
        for line in shard.read_text(encoding="utf-8").splitlines():
            edges.append(Edge.from_json(line))
    edges.sort(key=lambda e: e.t_e)
    return edges


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged-dir", required=True, type=Path, help="Directory of staged NDJSON shards (stage_lanl.py output)")
    parser.add_argument("--redteam", required=True, type=Path, help="Path to redteam.txt ground truth")
    parser.add_argument("--epoch-start", type=int, default=DEFAULT_EPOCH_START)
    parser.add_argument("--z-threshold", type=float, default=3.0)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    edges = _replay_staged_edges(args.staged_dir)
    labels = load_redteam_labels(args.redteam, args.epoch_start)

    decay = DecayEngine()
    baseline = BaselineStore()
    motif_engine = MotifEngine(definitions=MotifRegistry().all(), state_store=InMemoryMotifStateStore())

    signals: list[DeviationSignal] = []
    completions: list[MotifCompletionEvent] = []
    for edge in edges:
        refreshed = decay.refresh(edge, edge.t_e)
        signals.append(baseline.observe_edge(refreshed))
        completions.extend(motif_engine.on_edge(edge))

    report = run_pilot(signals, completions, labels, z_threshold=args.z_threshold)
    payload = {"anomaly": asdict(report.anomaly), "motif": asdict(report.motif)}
    output = json.dumps(payload, indent=2)
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
