"""Active Graph Store: mutable, PyTorch-Geometric-compatible edge store (tasks.md 2.1, FR2, NFR3).

design.md 2.4 calls this a `TemporalEdgeStore`: a hash map keyed by edge id
plus per-node adjacency lists, replacing PyG's static `edge_index` tensor
model so edges can be dynamically inserted/removed without rebuilding the
whole tensor graph on every step. `to_pyg_edge_index()` is the "compatible
with PyTorch Geometric" surface (design.md 2.4/tech-stack note) -- it
materializes the *current* live state into the tensor shape PyG expects,
computed fresh on each call rather than cached, so it reflects "dynamic
dropping of edges during the forward pass" (Phase 5 will call this from the
customized forward pass; Phase 2 does not do message-passing itself).

Thread-safety: a single `RLock` guards all mutations (`upsert`/`remove`) and
snapshot reads (`edges()`/`to_pyg_edge_index()`), each held only for the
duration of a dict/set operation -- never across external I/O -- so the
Pruning Watcher (tasks.md 2.2) running on a background thread does not hold
this lock while writing to cold storage (see pruning.py), keeping reads
(the eventual T-GNN inference path, tasks.md 2.6/FR2.5) from stalling on a
slow prune cycle.
"""

from __future__ import annotations

import threading
from collections import defaultdict
from typing import Optional

import torch

from t_gnn.schema import Edge


class ActiveGraphStore:
    """In-memory, dynamically mutable edge store keyed by edge id."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._edges: dict[str, Edge] = {}
        self._outgoing: dict[str, set[str]] = defaultdict(set)  # node_id -> edge_ids where node is src
        self._incoming: dict[str, set[str]] = defaultdict(set)  # node_id -> edge_ids where node is dst

    def upsert(self, edge: Edge) -> None:
        """Insert a new edge, or replace an existing one with the same edge_id."""
        with self._lock:
            existing = self._edges.get(edge.edge_id)
            if existing is not None:
                self._detach(existing)
            self._edges[edge.edge_id] = edge
            self._outgoing[edge.src].add(edge.edge_id)
            self._incoming[edge.dst].add(edge.edge_id)

    def remove(self, edge_id: str) -> Optional[Edge]:
        """Remove an edge by id, returning it if present (None if already gone)."""
        with self._lock:
            edge = self._edges.pop(edge_id, None)
            if edge is not None:
                self._detach(edge)
            return edge

    def _detach(self, edge: Edge) -> None:
        """Remove edge_id from adjacency sets, pruning now-empty node entries."""
        out_set = self._outgoing.get(edge.src)
        if out_set is not None:
            out_set.discard(edge.edge_id)
            if not out_set:
                del self._outgoing[edge.src]
        in_set = self._incoming.get(edge.dst)
        if in_set is not None:
            in_set.discard(edge.edge_id)
            if not in_set:
                del self._incoming[edge.dst]

    def get(self, edge_id: str) -> Optional[Edge]:
        with self._lock:
            return self._edges.get(edge_id)

    def edges(self) -> list[Edge]:
        """Snapshot of all active edges at this instant."""
        with self._lock:
            return list(self._edges.values())

    def __len__(self) -> int:
        with self._lock:
            return len(self._edges)

    def neighbors(self, node_id: str, direction: str = "out") -> list[str]:
        """Node ids reachable from `node_id` via active edges.

        direction: "out" (edges where node_id is src), "in" (node_id is
        dst), or "both".
        """
        with self._lock:
            edge_ids: set[str] = set()
            if direction in ("out", "both"):
                edge_ids |= self._outgoing.get(node_id, set())
            if direction in ("in", "both"):
                edge_ids |= self._incoming.get(node_id, set())
            result = []
            for eid in edge_ids:
                edge = self._edges[eid]
                result.append(edge.dst if edge.src == node_id else edge.src)
            return result

    def to_pyg_edge_index(self) -> tuple[torch.Tensor, list[str], dict[str, int]]:
        """Materialize the current live graph as a PyTorch Geometric edge_index.

        Returns (edge_index, edge_ids, node_index):
          - edge_index: torch.LongTensor of shape [2, E] (row 0 = src node
            indices, row 1 = dst node indices), matching PyG's convention.
          - edge_ids: length-E list of edge ids, column-aligned with edge_index.
          - node_index: node id -> integer index used in edge_index, in the
            same order the nodes were first encountered this call.

        Computed fresh from the live store on every call (not cached), so it
        always reflects edges inserted/removed since the last call.
        """
        with self._lock:
            edges = list(self._edges.values())

        node_index: dict[str, int] = {}
        src_indices: list[int] = []
        dst_indices: list[int] = []
        edge_ids: list[str] = []

        def _index_for(node_id: str) -> int:
            idx = node_index.get(node_id)
            if idx is None:
                idx = len(node_index)
                node_index[node_id] = idx
            return idx

        for edge in edges:
            src_indices.append(_index_for(edge.src))
            dst_indices.append(_index_for(edge.dst))
            edge_ids.append(edge.edge_id)

        edge_index = torch.tensor([src_indices, dst_indices], dtype=torch.long)
        return edge_index, edge_ids, node_index
