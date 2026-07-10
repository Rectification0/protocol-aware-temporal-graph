"""Calibration pass for protocol decay constants (tasks.md 1.7, specs.md FR5.4).

Derives a suggested `lambda_p` per protocol from staged LANL edges (the
output of stage_lanl.py, task 0.4): for each protocol, collect the gaps
between consecutive edges sharing the same (src entity, protocol), and set
the suggested half-life to the median gap -- i.e. `lambda_p = ln(2) /
median_gap_seconds`. This operationalizes the reasoning already documented
in config/protocols.yaml (each protocol's half-life is picked to match how
long that protocol's sessions/tickets/shares are typically live).

This is a calibration *aid*, not an auto-apply step: it prints/writes a
report of (sample_count, median_gap, suggested_lambda_p) per protocol and
leaves the decision to update config/protocols.yaml to a human, since a
protocol with too few samples in a given replay window shouldn't silently
overwrite a reasoned expert default (tasks.md 1.7 explicitly allows falling
back to expert defaults when neither real telemetry nor sufficient replay
data is available).

Only the tiny synthetic fixture (data/lanl/raw/sample_auth.txt.gz) is
vendored in this repo -- running this script against it is a smoke test of
the calibration mechanism, not a real calibration; the real multi-GB LANL
dataset must be acquired separately (see data/lanl/README.md) and staged
via stage_lanl.py before this script's output is meaningful.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

from t_gnn.protocol_registry import ProtocolDecayRegistry
from t_gnn.schema import Edge

DEFAULT_MIN_SAMPLES = 30


@dataclass
class CalibrationResult:
    protocol: str
    sample_count: int
    median_gap_seconds: Optional[float]
    suggested_lambda_p: Optional[float]
    suggested_half_life_hours: Optional[float]
    current_lambda_p: float
    sufficient_data: bool


def load_staged_edges(staged_dir: Path) -> list[Edge]:
    edges: list[Edge] = []
    for shard_path in sorted(staged_dir.glob("shard-*.jsonl")):
        with open(shard_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    edges.append(Edge.from_json(line))
    return edges


def gaps_by_protocol(edges: list[Edge]) -> dict[str, list[float]]:
    """Inter-arrival gaps (seconds) between consecutive edges sharing the
    same (src entity, protocol), grouped by protocol across all entities."""
    by_entity_protocol: dict[tuple[str, str], list[float]] = defaultdict(list)
    for edge in edges:
        by_entity_protocol[(edge.src, edge.protocol)].append(edge.t_e)

    gaps: dict[str, list[float]] = defaultdict(list)
    for (_, protocol), timestamps in by_entity_protocol.items():
        timestamps.sort()
        for prev, curr in zip(timestamps, timestamps[1:]):
            gap = curr - prev
            if gap > 0:
                gaps[protocol].append(gap)
    return gaps


def calibrate(
    staged_dir: Path,
    registry: Optional[ProtocolDecayRegistry] = None,
    min_samples: int = DEFAULT_MIN_SAMPLES,
) -> list[CalibrationResult]:
    registry = registry or ProtocolDecayRegistry()
    edges = load_staged_edges(staged_dir)
    gaps = gaps_by_protocol(edges)

    results = []
    for protocol in registry.protocols:
        protocol_gaps = gaps.get(protocol, [])
        sample_count = len(protocol_gaps)
        sufficient = sample_count >= min_samples
        current_lambda = registry.lambda_for(protocol)

        median_gap = None
        suggested_lambda = None
        suggested_half_life = None
        if sufficient:
            median_gap = statistics.median(protocol_gaps)
            if median_gap > 0:
                suggested_lambda = math.log(2) / median_gap
                suggested_half_life = median_gap / 3600.0

        results.append(
            CalibrationResult(
                protocol=protocol,
                sample_count=sample_count,
                median_gap_seconds=median_gap,
                suggested_lambda_p=suggested_lambda,
                suggested_half_life_hours=suggested_half_life,
                current_lambda_p=current_lambda,
                sufficient_data=sufficient,
            )
        )
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged-dir", required=True, type=Path, help="Directory of staged NDJSON shards (stage_lanl.py output)")
    parser.add_argument("--output", type=Path, help="Optional path to write the JSON calibration report")
    parser.add_argument("--min-samples", type=int, default=DEFAULT_MIN_SAMPLES, help="Minimum gap samples required before trusting a protocol's suggestion over its current default")
    args = parser.parse_args()

    results = calibrate(args.staged_dir, min_samples=args.min_samples)
    report = [asdict(r) for r in results]
    output_text = json.dumps(report, indent=2)

    print(output_text)
    if args.output:
        args.output.write_text(output_text, encoding="utf-8")


if __name__ == "__main__":
    main()
