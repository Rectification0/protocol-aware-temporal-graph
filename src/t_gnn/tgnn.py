"""T-GNN integration layer (tasks.md 5.1-5.3, specs.md FR1.5/FR3.4, design.md 2.4/2.8).

specs.md §4 Non-Goals explicitly excludes "replacing the T-GNN model
architecture itself (embedding generation, attention mechanism)" -- this
phase is the data/integration layer *around* a T-GNN, not the model
architecture's design or training. `DynamicTGNN` below is therefore a
deliberately small, untrained (randomly initialized) PyTorch Geometric
model -- the same staging role `decay.py` plays for a Flink job -- whose
job is to exercise the three real integration points tasks.md 5.1-5.3 ask
for, not to be a production-accurate anomaly detector:

  - 5.1: `DynamicTGNN.score_entities()` re-fetches `edge_index` from the
    *live* `ActiveGraphStore` on every call via `to_pyg_edge_index()`
    (graph_store.py) -- edges pruned since the last call are simply absent
    from the next forward pass, satisfying design.md 2.4's "dynamic
    dropping of edges during the forward pass" without any caching layer
    of its own to keep in sync.
  - 5.2: the feature vector for each node concatenates a stable per-entity
    embedding with that entity's latest FR1.5 deviation z-score (from
    `TGNNInferenceEngine.observe_deviation()`), so a "low and slow" outlier
    literally becomes part of what the forward pass sees, not just a
    side-channel alert.
  - 5.3: `TGNNInferenceEngine.on_motif_completion()` is a `MotifAlertBus`
    subscriber (motif_engine.py) that scores only the completed motif's
    local neighborhood immediately, instead of waiting for the next
    scheduled pass -- design.md 2.8's "targeted/immediate inference" fast
    path.

Swapping in a production-trained architecture later means replacing
`DynamicTGNN`'s layers, not touching how the engine sources its graph,
features, or triggers.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

import torch
from torch_geometric.nn import SAGEConv

from t_gnn.baseline import DeviationSignal
from t_gnn.graph_store import ActiveGraphStore
from t_gnn.motif_engine import MotifAlertBus, MotifCompletionEvent

logger = logging.getLogger(__name__)

DEFAULT_BASE_FEATURE_DIM = 8
DEFAULT_HIDDEN_DIM = 16


class EntityFeatureTable:
    """Stable node_id -> embedding-row registry.

    `ActiveGraphStore.to_pyg_edge_index()` assigns each node a fresh
    integer index, in first-encountered order, on *every* call -- perfectly
    fine for building one forward pass's `edge_index`, but not a stable
    identity across calls. This table is the layer that keeps a durable
    row per entity id across calls, the role a production T-GNN's entity
    id -> embedding lookup would play; it grows lazily as new entities are
    first seen.
    """

    def __init__(self, feature_dim: int = DEFAULT_BASE_FEATURE_DIM) -> None:
        self.feature_dim = feature_dim
        self._index: dict[str, int] = {}
        self._embedding = torch.nn.Embedding(0, feature_dim)

    def __len__(self) -> int:
        return len(self._index)

    def _grow(self, n_new: int) -> None:
        old = self._embedding
        new = torch.nn.Embedding(old.num_embeddings + n_new, self.feature_dim)
        with torch.no_grad():
            if old.num_embeddings:
                new.weight[: old.num_embeddings] = old.weight
        self._embedding = new

    def rows_for(self, node_ids: list[str]) -> torch.Tensor:
        """Feature rows for `node_ids`, in the given order. Any node id
        seen for the first time is assigned a fresh (randomly initialized)
        embedding row that persists for the table's lifetime."""
        new_ids = [n for n in node_ids if n not in self._index]
        if new_ids:
            self._grow(len(new_ids))
            for node_id in new_ids:
                self._index[node_id] = len(self._index)
        row_indices = torch.tensor([self._index[n] for n in node_ids], dtype=torch.long)
        return self._embedding(row_indices)


class DynamicTGNN(torch.nn.Module):
    """Reference forward pass: two `SAGEConv` layers over the live active
    graph plus a linear anomaly-score head. See module docstring -- this
    architecture is intentionally minimal (specs.md §4 Non-Goals)."""

    def __init__(self, base_feature_dim: int = DEFAULT_BASE_FEATURE_DIM, hidden_dim: int = DEFAULT_HIDDEN_DIM) -> None:
        super().__init__()
        self.entity_features = EntityFeatureTable(base_feature_dim)
        # +1 input column: FR1.5's deviation z-score (5.2), appended to the
        # entity's stable base embedding.
        self.conv1 = SAGEConv(base_feature_dim + 1, hidden_dim)
        self.conv2 = SAGEConv(hidden_dim, hidden_dim)
        self.score_head = torch.nn.Linear(hidden_dim, 1)

    def forward(self, edge_index: torch.Tensor, x: torch.Tensor) -> torch.Tensor:
        h = torch.relu(self.conv1(x, edge_index))
        h = torch.relu(self.conv2(h, edge_index))
        return self.score_head(h).squeeze(-1)

    @torch.no_grad()
    def score_entities(
        self,
        store: ActiveGraphStore,
        deviation_features: dict[str, float],
        entity_ids: Optional[list[str]] = None,
    ) -> dict[str, float]:
        """5.1/5.2: the customized forward pass. Re-reads the store's
        *current* edge_index/node_index (dynamic edge dropping, 5.1),
        builds each node's feature row from its stable embedding plus its
        latest deviation z-score (0.0 if none observed yet), and returns
        an anomaly score per node id.

        `entity_ids`, if given, restricts the *returned* set to those ids
        (used by the motif fast-path, 5.3) -- an id not currently present
        as a node in the live store (e.g. already pruned) is silently
        omitted rather than erroring.
        """
        edge_index, _edge_ids, node_index = store.to_pyg_edge_index()
        if not node_index:
            return {}

        ordered_ids = list(node_index.keys())
        base = self.entity_features.rows_for(ordered_ids)
        deviation = torch.tensor(
            [deviation_features.get(n, 0.0) for n in ordered_ids], dtype=torch.float32
        ).unsqueeze(1)
        x = torch.cat([base, deviation], dim=1)

        scores = self.forward(edge_index, x)
        result = {node_id: scores[idx].item() for node_id, idx in node_index.items()}

        if entity_ids is not None:
            result = {n: result[n] for n in entity_ids if n in result}
        return result


@dataclass
class InferenceResult:
    entity_id: str
    score: float
    t: float
    trigger: str  # "scheduled" | "motif_completion"
    motif_name: Optional[str] = None


class InferenceResultBus:
    """In-process pub/sub for inference results, the same standing-in role
    `PruneEventBus`/`MotifAlertBus` play for their events -- the real
    Alert/Signal Bus (design.md's architecture diagram) is downstream
    infrastructure this doesn't attempt to replace."""

    def __init__(self) -> None:
        self._subscribers: list[Callable[[InferenceResult], None]] = []

    def subscribe(self, callback: Callable[[InferenceResult], None]) -> None:
        self._subscribers.append(callback)

    def publish(self, result: InferenceResult) -> None:
        for callback in self._subscribers:
            callback(result)


class TGNNInferenceEngine:
    """Ties the live Active Graph Store, the deviation-signal feature cache
    (5.2), and motif-completion fast-path triggers (5.3) into the
    periodic-or-on-trigger inference loop design.md 2.8 describes."""

    def __init__(
        self,
        store: ActiveGraphStore,
        model: Optional[DynamicTGNN] = None,
        result_bus: Optional[InferenceResultBus] = None,
        alert_bus: Optional[MotifAlertBus] = None,
        poll_interval: float = 1.0,
    ) -> None:
        self.store = store
        self.model = model or DynamicTGNN()
        self.result_bus = result_bus or InferenceResultBus()
        self.poll_interval = poll_interval
        self._deviation_features: dict[str, float] = {}
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        if alert_bus is not None:
            alert_bus.subscribe(self.on_motif_completion)

    def observe_deviation(self, signal: DeviationSignal) -> None:
        """FR1.5/5.2: record the latest deviation z-score for an entity so
        the next inference pass (scheduled or triggered) uses it as a
        feature. A `None` z-score (too few prior samples, see
        baseline.py's `MIN_SAMPLES_FOR_DEVIATION`) leaves any previously
        recorded value untouched rather than resetting it to 0."""
        if signal.z_score is not None:
            self._deviation_features[signal.entity] = signal.z_score

    def run_once(self, t: float) -> list[InferenceResult]:
        """The scheduled inference pass (design.md 2.8's "periodically")
        over every node currently in the Active Graph Store."""
        scores = self.model.score_entities(self.store, self._deviation_features)
        results = [
            InferenceResult(entity_id=node_id, score=score, t=t, trigger="scheduled")
            for node_id, score in scores.items()
        ]
        for result in results:
            self.result_bus.publish(result)
        return results

    def on_motif_completion(self, event: MotifCompletionEvent) -> list[InferenceResult]:
        """5.3: the fast-path trigger. Scores only the completed motif's
        local neighborhood immediately, rather than waiting for the next
        scheduled `run_once()` (design.md 2.8's "targeted/immediate
        inference over the relevant local neighborhood")."""
        targeted = self._neighborhood_for(event)
        scores = self.model.score_entities(self.store, self._deviation_features, entity_ids=targeted)
        results = [
            InferenceResult(
                entity_id=node_id, score=score, t=event.completed_at,
                trigger="motif_completion", motif_name=event.motif_name,
            )
            for node_id, score in scores.items()
        ]
        for result in results:
            self.result_bus.publish(result)
        return results

    def _neighborhood_for(self, event: MotifCompletionEvent) -> list[str]:
        """`matched_edges` are opaque `make_edge_id()` hashes (schema.py)
        that don't carry endpoint node ids, so the one identity guaranteed
        available from a `MotifCompletionEvent` is its `chain_key` -- the
        entity the whole match pivots on (motifs.py). Expanding to that
        entity's immediate neighbors in the *live* store approximates
        design.md 2.8's "relevant local neighborhood" rather than scoring
        a single node."""
        neighborhood = {event.chain_key}
        neighborhood.update(self.store.neighbors(event.chain_key, direction="both"))
        return list(neighborhood)

    def start(self) -> None:
        """Run the scheduled inference loop on a background daemon thread."""
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
                logger.error("inference pass failed", exc_info=True)
            self._stop_event.wait(self.poll_interval)
