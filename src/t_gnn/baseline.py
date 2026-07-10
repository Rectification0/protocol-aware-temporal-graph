"""Rolling baseline distribution + deviation signal (tasks.md 1.4-1.5, specs.md FR1.4-FR1.5).

design.md 2.3 assigns this to a Flink stateful operator holding an EWMA
mean/variance profile of aggregated w(e,t) per (entity, protocol), keyed as
Flink keyed state. This module is the framework-agnostic version of that
logic -- an in-memory keyed store -- following the same staging pattern as
decay.py/protocol_registry.py; it becomes the business logic inside a real
KeyedProcessFunction once that job exists.

"entity" is taken as the edge's `src` id (the acting principal): the
initiator of a connection/auth/RCE is the entity whose behavior we baseline,
per functionality.txt's "aggregated edge weights for a specific user".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from t_gnn.schema import Edge

DEFAULT_ALPHA = 0.3  # EWMA smoothing factor: weight given to the newest sample
MIN_SAMPLES_FOR_DEVIATION = 2  # below this, variance is undefined/unstable


@dataclass
class DeviationSignal:
    """FR1.5: deviation of a fresh w(e,t) observation from its baseline.

    `z_score` is None until the baseline has enough prior samples (and
    nonzero variance) to make a z-score meaningful, rather than emitting a
    misleading 0/undefined value.
    """

    entity: str
    protocol: str
    t: float
    value: float
    baseline_mean: float
    baseline_std: float
    sample_count: int
    z_score: Optional[float]


class EWMABaseline:
    """Exponentially-weighted mean/variance for a single (entity, protocol) key."""

    def __init__(self, alpha: float = DEFAULT_ALPHA) -> None:
        self.alpha = alpha
        self.mean: float = 0.0
        self.variance: float = 0.0
        self.sample_count: int = 0

    def update(self, value: float) -> None:
        if self.sample_count == 0:
            self.mean = value
            self.variance = 0.0
        else:
            delta = value - self.mean
            self.mean += self.alpha * delta
            self.variance = (1 - self.alpha) * (self.variance + self.alpha * delta * delta)
        self.sample_count += 1

    @property
    def std(self) -> float:
        return self.variance**0.5


class BaselineStore:
    """Keyed (entity, protocol) -> EWMABaseline store (the Flink-keyed-state stand-in)."""

    def __init__(self, alpha: float = DEFAULT_ALPHA) -> None:
        self.alpha = alpha
        self._baselines: dict[tuple[str, str], EWMABaseline] = {}

    def _get_or_create(self, entity: str, protocol: str) -> EWMABaseline:
        key = (entity, protocol)
        baseline = self._baselines.get(key)
        if baseline is None:
            baseline = EWMABaseline(alpha=self.alpha)
            self._baselines[key] = baseline
        return baseline

    def observe(self, entity: str, protocol: str, value: float, t: float) -> DeviationSignal:
        """Record a new w(e,t) observation and return its deviation signal.

        The z-score is computed against the baseline as it stood *before*
        this observation is folded in, so a genuine outlier is scored
        against unpolluted history rather than a baseline it just nudged.
        """
        baseline = self._get_or_create(entity, protocol)
        pre_mean, pre_std, pre_count = baseline.mean, baseline.std, baseline.sample_count

        z_score = None
        if pre_count >= MIN_SAMPLES_FOR_DEVIATION and pre_std > 0.0:
            z_score = (value - pre_mean) / pre_std

        baseline.update(value)

        return DeviationSignal(
            entity=entity,
            protocol=protocol,
            t=t,
            value=value,
            baseline_mean=baseline.mean,
            baseline_std=baseline.std,
            sample_count=baseline.sample_count,
            z_score=z_score,
        )

    def observe_edge(self, edge: Edge, weight: Optional[float] = None) -> DeviationSignal:
        """Convenience wrapper: entity is edge.src, value is edge.w (or an override)."""
        value = weight if weight is not None else edge.w
        if value is None:
            raise ValueError("edge.w is None -- refresh decay weight before observing")
        t = edge.w_evaluated_at if edge.w_evaluated_at is not None else edge.t_e
        return self.observe(edge.src, edge.protocol, value, t)
