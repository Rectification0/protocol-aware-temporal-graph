"""Pruning Watcher: threshold-based dynamic graph pruning (tasks.md 2.2/2.3/2.5/2.6, FR2).

design.md 2.5's three steps map onto `PruningWatcher.run_once()`:
  1. Scan active edges, evaluate w(e,t) < epsilon (2.2) -- epsilon itself
     computed per-pass by `EpsilonController` from memory pressure,
     graph-size pressure (2.3, FR2.3/NFR3) and, when a probe is wired in,
     the Flink job's backpressure (Backlog B.2, design.md §5).
  2. On threshold breach: write to cold storage, *then* remove from the
     Active Graph Store (2.4/FR2.4's "before removal" ordering) -- if the
     cold-storage write fails, the edge is left in place to retry on the
     next pass rather than being dropped, so a transient Neo4j hiccup never
     loses data (a full buffered/async write path is deliberately deferred
     to tasks.md 6.4).
  3. Publish a "pruned" event (2.5) so downstream consumers (the Phase 3
     Motif Engine) can reset dependent partial-motif state (FR3.3).

Backlog B.12 adds a hard ceiling after those steps: if the graph is still
above `EpsilonController.max_edges` once the epsilon pass is done, the
lowest-weight survivors are pruned until it fits -- through the same
cold-storage-first path and prune events, tagged `reason="cap"`. Without
it, `max_edges` was only a pressure input: at full pressure epsilon stops at
`epsilon_max`, and fresh edges weighted above that all survived (B.7's
benchmark ended at 53.7k live edges against `max_edges=50,000`).

Non-blocking reads (2.6/FR2.5): the cold-storage write happens *without*
holding the store's lock (it operates on an already-read-out Edge, not the
store itself), so `ActiveGraphStore`'s lock is only held for the brief
dict/set mutation inside `remove()` -- a concurrent reader (the eventual
T-GNN inference path) is never blocked for the duration of slow write I/O,
only for a single dict pop.
"""

from __future__ import annotations

import heapq
import logging
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

from t_gnn.cold_storage import ColdStorageWriter
from t_gnn.decay import DecayEngine
from t_gnn.graph_store import ActiveGraphStore
from t_gnn.schema import Edge

logger = logging.getLogger(__name__)

MemoryProbe = Callable[[], Optional[float]]
BackpressureProbe = Callable[[], Optional[float]]  # 0-1 ratio, e.g. t_gnn.flink.backpressure.FlinkBackpressureProbe


def default_memory_probe() -> Optional[float]:
    """Current system memory utilization as a percentage (0-100), or None
    if it can't be read -- degrades gracefully per NFR4 rather than raising."""
    try:
        import psutil

        return psutil.virtual_memory().percent
    except Exception:
        logger.warning("memory probe failed; falling back to graph-size pressure only", exc_info=True)
        return None


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


class EpsilonController:
    """Computes the dynamic prune threshold epsilon from memory-pressure,
    graph-size pressure (tasks.md 2.3, FR2.3, NFR3) and ingestion
    backpressure (Backlog B.2).

    Pressure is the max of independent 0-1 signals -- whichever is more
    pressing dominates -- since FR2.3 asks for memory-awareness while NFR3
    demands a hard, configurable ceiling on graph *size*, and average
    per-edge memory footprint isn't guaranteed constant enough for a
    memory-only signal to reliably bound edge count on its own:
      - memory pressure: current system memory % scaled between
        `low_watermark`/`high_watermark`.
      - size pressure: current edge count / `max_edges`, if configured.
      - backpressure: the Flink job's backpressure ratio (share of time its
        operators spend blocked) scaled between `backpressure_low`/
        `backpressure_high`, if a reading is supplied. Flink itself calls
        <= 0.1 "ok" and > 0.5 "high", hence the defaults. This is design.md
        §5's "Flink backpressure during log spikes" mitigation: prune
        harder while ingestion can't keep up.
    epsilon is then interpolated linearly between `epsilon_min` (headroom
    available, prune conservatively) and `epsilon_max` (under pressure,
    prune aggressively).
    """

    def __init__(
        self,
        epsilon_min: float,
        epsilon_max: float,
        low_watermark: float = 70.0,
        high_watermark: float = 90.0,
        max_edges: Optional[int] = None,
        backpressure_low: float = 0.1,
        backpressure_high: float = 0.5,
    ) -> None:
        if epsilon_max < epsilon_min:
            raise ValueError("epsilon_max must be >= epsilon_min")
        if high_watermark <= low_watermark:
            raise ValueError("high_watermark must be > low_watermark")
        if backpressure_high <= backpressure_low:
            raise ValueError("backpressure_high must be > backpressure_low")
        self.epsilon_min = epsilon_min
        self.epsilon_max = epsilon_max
        self.low_watermark = low_watermark
        self.high_watermark = high_watermark
        self.max_edges = max_edges
        self.backpressure_low = backpressure_low
        self.backpressure_high = backpressure_high

    def compute_epsilon(
        self,
        current_edge_count: int,
        memory_percent: Optional[float] = None,
        backpressure_ratio: Optional[float] = None,
    ) -> float:
        mem_pressure = 0.0
        if memory_percent is not None:
            mem_pressure = _clamp((memory_percent - self.low_watermark) / (self.high_watermark - self.low_watermark))

        size_pressure = 0.0
        if self.max_edges:
            size_pressure = _clamp(current_edge_count / self.max_edges)

        backpressure = 0.0
        if backpressure_ratio is not None:
            backpressure = _clamp(
                (backpressure_ratio - self.backpressure_low) / (self.backpressure_high - self.backpressure_low)
            )

        pressure = max(mem_pressure, size_pressure, backpressure)
        return self.epsilon_min + pressure * (self.epsilon_max - self.epsilon_min)


@dataclass
class PrunedEdgeEvent:
    """FR3.3's trigger: published when an edge is severed from active memory."""

    edge: Edge
    w_at_prune: float
    pruned_at: float
    reason: str = "decay"  # "decay" (w < epsilon) or "cap" (B.12's max_edges ceiling)


class PruneEventBus:
    """In-process pub/sub for prune events (tasks.md 2.5).

    Plain synchronous callback registry standing in for whatever
    internal bus/topic a production deployment wires this to (design.md
    2.5 names Redis/Kafka-style options); Phase 3's Motif Engine is the
    first real subscriber and doesn't exist yet, so there's nothing to
    justify heavier infra for this specific hop today.
    """

    def __init__(self) -> None:
        self._subscribers: list[Callable[[PrunedEdgeEvent], None]] = []

    def subscribe(self, callback: Callable[[PrunedEdgeEvent], None]) -> None:
        self._subscribers.append(callback)

    def publish(self, event: PrunedEdgeEvent) -> None:
        for callback in self._subscribers:
            callback(event)


@dataclass
class PruningStats:
    scanned: int
    pruned: int
    epsilon: float
    write_failures: int = 0
    backpressure: Optional[float] = None  # the probe's reading this pass, if one is wired in (B.2)
    capped: int = 0  # B.12: how many of `pruned` the max_edges ceiling removed, not epsilon


class PruningWatcher:
    """Continuously evaluates w(e,t) < epsilon and prunes breaching edges."""

    def __init__(
        self,
        store: ActiveGraphStore,
        decay_engine: DecayEngine,
        epsilon_controller: EpsilonController,
        cold_storage: ColdStorageWriter,
        event_bus: Optional[PruneEventBus] = None,
        memory_probe: MemoryProbe = default_memory_probe,
        poll_interval: float = 1.0,
        backpressure_probe: Optional[BackpressureProbe] = None,
    ) -> None:
        self.store = store
        self.decay_engine = decay_engine
        self.epsilon_controller = epsilon_controller
        self.cold_storage = cold_storage
        self.event_bus = event_bus or PruneEventBus()
        self.memory_probe = memory_probe
        self.backpressure_probe = backpressure_probe
        self.poll_interval = poll_interval
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    def run_once(self, t: float) -> PruningStats:
        """One scan-and-prune pass at time t. Synchronous; safe to call
        directly in tests without starting the background thread."""
        edges = self.store.edges()
        backpressure = self.backpressure_probe() if self.backpressure_probe is not None else None
        epsilon = self.epsilon_controller.compute_epsilon(len(edges), self.memory_probe(), backpressure)

        max_edges = self.epsilon_controller.max_edges
        # B.12: only a snapshot above the cap can leave survivors to cap, so
        # only then are they collected. Weights go in a plain float list
        # (not per-edge tuples): allocating a tuple per edge every pass kept
        # triggering the garbage collector over the whole graph's Edges.
        collect = bool(max_edges) and len(edges) > max_edges
        survivor_edges: list[Edge] = []
        survivor_weights: list[float] = []

        pruned = 0
        write_failures = 0
        for edge in edges:
            w = self.decay_engine.weight_at(edge, t)
            if w >= epsilon:
                if collect:
                    survivor_edges.append(edge)
                    survivor_weights.append(w)
                continue
            outcome = self._prune(edge, w, t, reason="decay")
            pruned += outcome is True
            write_failures += outcome is None

        capped = 0
        if collect:
            # The hard ceiling. Measured against the live store, so an edge
            # upserted since the snapshot counts towards the overflow, but
            # only snapshot edges are candidates: newer ones wait for the
            # next pass. A failed write leaves the graph above the cap until
            # that pass retries it.
            excess = len(self.store) - max_edges
            if excess > 0:
                lightest = heapq.nsmallest(excess, range(len(survivor_weights)), key=survivor_weights.__getitem__)
                for i in lightest:
                    outcome = self._prune(survivor_edges[i], survivor_weights[i], t, reason="cap")
                    capped += outcome is True
                    write_failures += outcome is None
                pruned += capped

        return PruningStats(
            scanned=len(edges), pruned=pruned, epsilon=epsilon, write_failures=write_failures,
            backpressure=backpressure, capped=capped,
        )

    def _prune(self, edge: Edge, w: float, t: float, reason: str) -> Optional[bool]:
        """Cold storage first, then removal and the prune event (FR2.4/FR3.3).
        True if pruned, False if the edge was already gone, None if the
        cold-storage write failed (the edge stays active for a retry)."""
        try:
            self.cold_storage.write(edge, w, t)
        except Exception:
            logger.error("cold-storage write failed; leaving edge %s active for retry", edge.edge_id, exc_info=True)
            return None
        removed = self.store.remove(edge.edge_id)
        if removed is None:
            return False
        self.event_bus.publish(PrunedEdgeEvent(edge=removed, w_at_prune=w, pruned_at=t, reason=reason))
        return True

    def start(self) -> None:
        """Run the scan-and-prune loop on a background daemon thread (2.2/2.6)."""
        if self._thread is not None:
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self, timeout: Optional[float] = None) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=timeout)
            self._thread = None

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self.run_once(time.time())
            except Exception:
                logger.error("pruning pass failed", exc_info=True)
            self._stop_event.wait(self.poll_interval)
