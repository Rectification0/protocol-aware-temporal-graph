"""Protocol-aware asymmetric time-decay (tasks.md 1.1-1.3, specs.md FR1.1-FR1.3).

Framework-agnostic implementation of `w(e, t) = w_0 * e^(-lambda_p * (t - t_e))`.
design.md 2.1 assigns "continuously recompute w(e,t)" to a Flink streaming
job; this module is the business logic that job will call per edge once a
real Flink pipeline is stood up -- the same staging pattern already applied
to lambda_p lookup/hot-reload in protocol_registry.py (tasks.md 1.1/1.2 are
that registry's `.get()`/`.reload()`; this layers 1.3 on top of it).
"""

from __future__ import annotations

import math
from dataclasses import replace
from typing import Optional

from t_gnn.protocol_registry import ProtocolDecayRegistry
from t_gnn.schema import Edge


def compute_weight(w_0: float, lambda_p: float, t_e: float, t: float) -> float:
    """w(e, t) = w_0 * e^(-lambda_p * (t - t_e)) -- specs.md FR1.1.

    `t` before `t_e` (evaluating an edge before it occurred) is clamped to
    zero elapsed time rather than allowed to amplify weight above `w_0`.
    """
    elapsed = max(0.0, t - t_e)
    return w_0 * math.exp(-lambda_p * elapsed)


class DecayEngine:
    """Recomputes w(e, t) for edges via the shared Protocol Decay Registry."""

    def __init__(self, registry: Optional[ProtocolDecayRegistry] = None) -> None:
        self.registry = registry or ProtocolDecayRegistry()

    def weight_at(self, edge: Edge, t: float) -> float:
        lambda_p = self.registry.lambda_for(edge.protocol)
        return compute_weight(edge.w_0, lambda_p, edge.t_e, t)

    def refresh(self, edge: Edge, t: float) -> Edge:
        """Return a copy of `edge` with w/w_evaluated_at recomputed at time t."""
        return replace(edge, w=self.weight_at(edge, t), w_evaluated_at=t)
