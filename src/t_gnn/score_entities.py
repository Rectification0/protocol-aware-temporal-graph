"""Per-entity T-GNN inference scoring CLI (tasks.md 8.1).

`pilot.py` (7.3) evaluates the decay/baseline-deviation path (FR1.5) and
the motif-completion path (FR3.4) against labeled ground truth, but it
never actually invokes the PyTorch Geometric forward pass design.md §2.8
describes -- there was no tool that surfaced what `DynamicTGNN.score_entities()`
(tgnn.py, Phase 5) itself outputs for a given dataset. This module closes
that gap without touching Phase 5's engine or model: it replays staged
edges through the same real pipeline stages `pilot.py` already uses
(`DecayStreamProcessor` for 1.3-1.5, `MotifEngine` for 3.2-3.5) into an
`ActiveGraphStore` (2.1), wires `TGNNInferenceEngine` to the same
`MotifAlertBus` so motif completions during replay drive the 5.3 fast path
inline (matching design.md §3's data flow, steps 5-7), and then runs one
final scheduled pass (5.1/5.2) over every entity left in the graph.

Per specs.md §4's non-goal, this surfaces the existing untrained reference
model's output as-is -- it does not change, retrain, or otherwise touch
`DynamicTGNN`'s architecture.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path
from typing import Iterable, Optional

from t_gnn.graph_store import ActiveGraphStore
from t_gnn.motif_engine import InMemoryMotifStateStore, MotifAlertBus, MotifEngine
from t_gnn.motifs import MotifRegistry
from t_gnn.schema import Edge
from t_gnn.streaming import DecayStreamProcessor
from t_gnn.tgnn import InferenceResult, TGNNInferenceEngine


def _load_staged_edges(staged_dir: Path) -> list[Edge]:
    edges = []
    for shard in sorted(staged_dir.glob("shard-*.jsonl")):
        for line in shard.read_text(encoding="utf-8").splitlines():
            edges.append(Edge.from_json(line))
    edges.sort(key=lambda e: e.t_e)
    return edges


def score_staged_edges(edges: Iterable[Edge], top_n: Optional[int] = None) -> list[InferenceResult]:
    """Replays `edges` (assumed pre-sorted by `t_e`) through the real
    decay/baseline (1.3-1.5), motif delta-update (3.2-3.5), and Active
    Graph Store (2.1) pipeline stages, then runs the live T-GNN
    (`TGNNInferenceEngine`, Phase 5) over the resulting graph -- the piece
    `pilot.py` deliberately never exercises (see module docstring).

    Motif completions fire `TGNNInferenceEngine`'s fast path (5.3) inline
    as they occur during replay, same as design.md's data flow; the
    returned list is the final *scheduled* pass (5.1) over every entity
    still present in the graph after replay, sorted by score magnitude
    descending (most anomalous first, in either direction -- the reference
    model is untrained per specs.md §4, so its score's sign carries no
    fixed meaning, only relative magnitude does) and truncated to `top_n`
    if given.
    """
    store = ActiveGraphStore()
    processor = DecayStreamProcessor()
    alert_bus = MotifAlertBus()
    motif_engine = MotifEngine(
        definitions=MotifRegistry().all(),
        state_store=InMemoryMotifStateStore(),
        alert_bus=alert_bus,
    )
    inference_engine = TGNNInferenceEngine(store=store, alert_bus=alert_bus)

    last_t = 0.0
    for edge in edges:
        processed = processor.process(edge, t=edge.t_e)
        store.upsert(processed.edge)
        inference_engine.observe_deviation(processed.deviation)
        motif_engine.on_edge(edge)
        last_t = edge.t_e

    results = inference_engine.run_once(t=last_t)
    results.sort(key=lambda r: abs(r.score), reverse=True)
    if top_n is not None:
        results = results[:top_n]
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged-dir", required=True, type=Path, help="Directory of staged NDJSON shards (stage_lanl.py or simulate_traffic.py output)")
    parser.add_argument("--top", type=int, default=None, help="Only report the N highest-magnitude scores (default: all entities)")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    edges = _load_staged_edges(args.staged_dir)
    results = score_staged_edges(edges, top_n=args.top)

    payload = [asdict(r) for r in results]
    output = json.dumps(payload, indent=2)
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
