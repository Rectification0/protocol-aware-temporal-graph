"""Continuous/adaptive protocol decay calibration (tasks.md Backlog B.3).

`calibrate_decay.py` (task 1.7) derives a suggested `lambda_p` per protocol
from a one-shot offline batch of staged LANL edges -- an operator runs it,
reads the report, and hand-edits config/protocols.yaml. Proposal.docx §7
"Future Enhancements" asks for the online counterpart: "learning
protocol-specific decay behavior directly from historical data ... rather
than setting it through fixed constants, allowing the system to adapt as
network usage patterns evolve." This module reuses `calibrate_decay.py`'s
exact heuristic -- `lambda_p = ln(2) / median_gap_seconds`, where
`median_gap_seconds` is the median inter-arrival gap between consecutive
edges sharing the same `(src entity, protocol)` -- but applies it
continuously to a rolling window of *live* edges as they stream through
(fed alongside `DecayStreamProcessor.process()`, the same "caller invokes
explicitly" pattern `metrics.py`'s `observe_pruning_pass()`/
`observe_inference_pass()` already use), pushing an updated `lambda_p`
straight into a live `ProtocolDecayRegistry` via its new `update()` method
once a protocol clears `min_samples` again -- no operator hand-edit
required.

A `max_relative_change` clamp bounds how far a single recalibration can
move `lambda_p` from its current value: a noisy live window (e.g. one
unusually bursty hour) is a much less reliable signal than
`calibrate_decay.py`'s whole-dataset-at-once view, and an unclamped update
could otherwise let a single bad estimate swing `EpsilonController`-driven
pruning wildly -- design.md §5's "Incorrect lambda_p" failure mode, the
same one `tests/test_chaos.py` (6.5) exercises for a manual
misconfiguration.
"""

from __future__ import annotations

import logging
import math
import statistics
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Deque, Optional

from t_gnn.protocol_registry import ProtocolDecayRegistry
from t_gnn.schema import Edge

logger = logging.getLogger(__name__)

DEFAULT_MIN_SAMPLES = 30
DEFAULT_WINDOW_SIZE = 500
DEFAULT_UPDATE_INTERVAL_EDGES = 200
DEFAULT_MAX_RELATIVE_CHANGE = 0.25


@dataclass
class RecalibrationEvent:
    """One protocol's `lambda_p` actually changing as a result of a
    recalibration pass -- `applied_lambda_p` may differ from
    `suggested_lambda_p` if `max_relative_change` clamped it."""

    protocol: str
    previous_lambda_p: float
    suggested_lambda_p: float
    applied_lambda_p: float
    sample_count: int
    t: float


class AdaptiveDecayCalibrator:
    """Observes live edges (`observe()`) and periodically recalibrates
    `registry`'s `lambda_p` per protocol from a rolling window of recent
    same-entity inter-arrival gaps -- the same statistic
    `calibrate_decay.gaps_by_protocol()`/`calibrate()` compute from a
    static file, applied continuously instead of as a one-shot batch."""

    def __init__(
        self,
        registry: ProtocolDecayRegistry,
        min_samples: int = DEFAULT_MIN_SAMPLES,
        window_size: int = DEFAULT_WINDOW_SIZE,
        update_interval_edges: int = DEFAULT_UPDATE_INTERVAL_EDGES,
        max_relative_change: float = DEFAULT_MAX_RELATIVE_CHANGE,
    ) -> None:
        self.registry = registry
        self.min_samples = min_samples
        self.window_size = window_size
        self.update_interval_edges = update_interval_edges
        self.max_relative_change = max_relative_change
        self._last_seen: dict[tuple[str, str], float] = {}
        self._gaps: dict[str, Deque[float]] = defaultdict(lambda: deque(maxlen=window_size))
        self._edges_since_update = 0
        self.history: list[RecalibrationEvent] = []

    def observe(self, edge: Edge) -> list[RecalibrationEvent]:
        """Feed one live edge through the rolling-gap tracker. Returns any
        `RecalibrationEvent`s actually applied as a result -- usually
        empty; only non-empty every `update_interval_edges` edges, and only
        for protocols whose `lambda_p` actually moved."""
        key = (edge.src, edge.protocol)
        previous_ts = self._last_seen.get(key)
        self._last_seen[key] = edge.t_e
        if previous_ts is not None:
            gap = edge.t_e - previous_ts
            if gap > 0:
                self._gaps[edge.protocol].append(gap)

        self._edges_since_update += 1
        if self._edges_since_update < self.update_interval_edges:
            return []
        self._edges_since_update = 0
        return self._recalibrate(t=edge.t_e)

    def _recalibrate(self, t: float) -> list[RecalibrationEvent]:
        events: list[RecalibrationEvent] = []
        for protocol, gaps in self._gaps.items():
            if len(gaps) < self.min_samples:
                continue
            median_gap = statistics.median(gaps)
            if median_gap <= 0:
                continue
            suggested = math.log(2) / median_gap
            current = self.registry.lambda_for(protocol)
            applied = self._clamp(current, suggested)
            if applied == current:
                continue
            self.registry.update(protocol, applied)
            event = RecalibrationEvent(
                protocol=protocol, previous_lambda_p=current, suggested_lambda_p=suggested,
                applied_lambda_p=applied, sample_count=len(gaps), t=t,
            )
            self.history.append(event)
            events.append(event)
            logger.info(
                "adaptive recalibration: %s lambda_p %.6g -> %.6g (suggested %.6g, %d samples)",
                protocol, current, applied, suggested, len(gaps),
            )
        return events

    def _clamp(self, current: float, suggested: float) -> float:
        if current <= 0:
            return suggested
        lower = current * (1.0 - self.max_relative_change)
        upper = current * (1.0 + self.max_relative_change)
        return min(max(suggested, lower), upper)
