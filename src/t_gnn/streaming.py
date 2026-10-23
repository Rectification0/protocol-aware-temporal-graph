"""Per-edge streaming pipeline step tying decay + baseline together
(tasks.md 1.1-1.5, design.md section 3 "Data Flow" steps 2-4).

This is the in-process version of the Flink streaming job's per-record
logic: recompute w(e,t) (decay.py), then feed the result into the
entity/protocol baseline (baseline.py) to produce a deviation signal. The
real Flink job (Backlog B.1, `t_gnn.flink.decay_job`) runs the same two
functions as keyed operators and produces the same `ProcessedEdge`s;
`scripts/run_pipeline.py --decay-backend` picks which one runs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from t_gnn.baseline import BaselineStore, DeviationSignal
from t_gnn.decay import DecayEngine
from t_gnn.protocol_registry import ProtocolDecayRegistry
from t_gnn.schema import Edge


@dataclass
class ProcessedEdge:
    edge: Edge  # w / w_evaluated_at refreshed at the processing time
    deviation: DeviationSignal


class DecayStreamProcessor:
    """Combines DecayEngine (1.1-1.3) and BaselineStore (1.4-1.5) into the
    single per-edge streaming step described in design.md's data-flow."""

    def __init__(
        self,
        registry: Optional[ProtocolDecayRegistry] = None,
        baseline_store: Optional[BaselineStore] = None,
    ) -> None:
        self.decay_engine = DecayEngine(registry=registry)
        self.baseline_store = baseline_store or BaselineStore()

    def process(self, edge: Edge, t: float) -> ProcessedEdge:
        refreshed = self.decay_engine.refresh(edge, t)
        deviation = self.baseline_store.observe_edge(refreshed)
        return ProcessedEdge(edge=refreshed, deviation=deviation)
