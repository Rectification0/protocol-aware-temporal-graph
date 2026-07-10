"""Observability metrics (tasks.md 6.2).

No metrics-visualization stack (Prometheus/Grafana) is provisioned in
docker-compose.yml -- design.md doesn't name one, and NFR1-5 only require
the underlying quantities be observable, not a specific product.
`MetricsCollector` is therefore the framework-agnostic in-process
aggregator a real dashboard's scrape/export endpoint would read from, the
same staging role decay.py plays for a Flink job, rather than a
speculative integration with a specific vendor nobody has asked for yet.

The five tracked quantities (tasks.md 6.2), and where each one's data
already comes from:
  - **active graph size**: read live from `ActiveGraphStore.__len__` at
    snapshot time -- not worth tracking as a rolling series when the
    store can just be asked directly.
  - **prune rate**: prunes/second over a trailing window, from
    `pruning.py`'s `PruneEventBus` -- `PruningWatcher`'s own,
    already-existing prune-event publication (2.5), not a new hook.
  - **epsilon over time**: a chronological series of every
    `EpsilonController` reading, recorded via `observe_pruning_pass()`,
    which the caller invokes with each `PruningWatcher.run_once()`
    pass's returned `PruningStats` -- no change to `PruningWatcher`
    itself, since it already returns everything needed.
  - **motif cache hit/reset rate**: "hit" = `MotifCompletionEvent`s (a
    partial match paid off) via `MotifAlertBus`; "reset" =
    `MotifResetEvent`s (6.1) via `MotifResetBus` -- both are events
    FR3.3/FR3.4 already require the engine to emit, not new
    instrumentation. (This module treats "hit" as *motif completion*
    specifically, i.e. detections, rather than every intermediate-stage
    advance -- the more externally meaningful of the two readings, and
    the one design.md's own vocabulary ("cache hit") maps onto most
    directly.)
  - **inference latency**: wall-clock duration of each
    `TGNNInferenceEngine` pass, recorded via `observe_inference_pass()`,
    which the caller invokes around each `run_once()`/`on_motif_completion()`
    call the same way `observe_pruning_pass()` wraps `PruningWatcher`.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Optional

from t_gnn.graph_store import ActiveGraphStore
from t_gnn.motif_engine import MotifAlertBus, MotifCompletionEvent, MotifResetBus, MotifResetEvent
from t_gnn.pruning import PruneEventBus, PrunedEdgeEvent, PruningStats


class RollingRateCounter:
    """Events/second over a trailing `window_seconds`, from timestamped
    `record()` calls -- the shared primitive behind prune rate and motif
    hit/reset rates."""

    def __init__(self, window_seconds: float = 60.0) -> None:
        self.window_seconds = window_seconds
        self._timestamps: deque[float] = deque()

    def record(self, t: float) -> None:
        self._timestamps.append(t)
        self._evict(t)

    def rate(self, now: float) -> float:
        self._evict(now)
        if not self.window_seconds:
            return 0.0
        return len(self._timestamps) / self.window_seconds

    def count(self, now: float) -> int:
        self._evict(now)
        return len(self._timestamps)

    def _evict(self, now: float) -> None:
        cutoff = now - self.window_seconds
        while self._timestamps and self._timestamps[0] < cutoff:
            self._timestamps.popleft()


@dataclass
class EpsilonReading:
    t: float
    epsilon: float
    scanned: int
    pruned: int


@dataclass
class InferenceLatencyReading:
    t: float
    latency_seconds: float
    trigger: str
    result_count: int


@dataclass
class MetricsSnapshot:
    active_graph_size: int
    prune_rate_per_second: float
    epsilon: Optional[float]
    motif_hit_rate_per_second: float
    motif_reset_rate_per_second: float
    latest_inference_latency_seconds: Optional[float]


class MetricsCollector:
    """Aggregates the five tasks.md 6.2 quantities. Subscribes to whichever
    buses are passed in (all optional, mirroring `MotifEngine`'s
    constructor pattern); `observe_pruning_pass()`/`observe_inference_pass()`
    are called explicitly by whoever drives those passes, since
    `PruningWatcher`/`TGNNInferenceEngine` already return everything needed
    without requiring a new hook into either class."""

    def __init__(
        self,
        store: ActiveGraphStore,
        window_seconds: float = 60.0,
        prune_bus: Optional[PruneEventBus] = None,
        alert_bus: Optional[MotifAlertBus] = None,
        reset_bus: Optional[MotifResetBus] = None,
        max_history: int = 1000,
    ) -> None:
        self.store = store
        self.max_history = max_history
        self.prune_rate = RollingRateCounter(window_seconds)
        self.motif_hit_rate = RollingRateCounter(window_seconds)
        self.motif_reset_rate = RollingRateCounter(window_seconds)
        self.epsilon_history: list[EpsilonReading] = []
        self.inference_latency_history: list[InferenceLatencyReading] = []

        if prune_bus is not None:
            prune_bus.subscribe(self._on_prune)
        if alert_bus is not None:
            alert_bus.subscribe(self._on_motif_completion)
        if reset_bus is not None:
            reset_bus.subscribe(self._on_motif_reset)

    def active_graph_size(self) -> int:
        return len(self.store)

    def _on_prune(self, event: PrunedEdgeEvent) -> None:
        self.prune_rate.record(event.pruned_at)

    def _on_motif_completion(self, event: MotifCompletionEvent) -> None:
        self.motif_hit_rate.record(event.completed_at)

    def _on_motif_reset(self, event: MotifResetEvent) -> None:
        self.motif_reset_rate.record(event.reset_at)

    def observe_pruning_pass(self, stats: PruningStats, t: float) -> None:
        """Record one `PruningWatcher.run_once()` pass's epsilon reading."""
        self.epsilon_history.append(
            EpsilonReading(t=t, epsilon=stats.epsilon, scanned=stats.scanned, pruned=stats.pruned)
        )
        if len(self.epsilon_history) > self.max_history:
            del self.epsilon_history[: len(self.epsilon_history) - self.max_history]

    def observe_inference_pass(self, results: list, latency_seconds: float, t: float, trigger: str) -> None:
        """Record one `TGNNInferenceEngine.run_once()`/`on_motif_completion()`
        pass's wall-clock latency."""
        self.inference_latency_history.append(
            InferenceLatencyReading(t=t, latency_seconds=latency_seconds, trigger=trigger, result_count=len(results))
        )
        if len(self.inference_latency_history) > self.max_history:
            del self.inference_latency_history[: len(self.inference_latency_history) - self.max_history]

    def snapshot(self, now: float) -> MetricsSnapshot:
        """A dashboard-ready snapshot of all five tracked quantities."""
        return MetricsSnapshot(
            active_graph_size=self.active_graph_size(),
            prune_rate_per_second=self.prune_rate.rate(now),
            epsilon=self.epsilon_history[-1].epsilon if self.epsilon_history else None,
            motif_hit_rate_per_second=self.motif_hit_rate.rate(now),
            motif_reset_rate_per_second=self.motif_reset_rate.rate(now),
            latest_inference_latency_seconds=(
                self.inference_latency_history[-1].latency_seconds if self.inference_latency_history else None
            ),
        )
