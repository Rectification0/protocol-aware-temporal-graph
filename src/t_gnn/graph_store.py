"""Active Graph Store: mutable, PyTorch-Geometric-compatible edge store (tasks.md 2.1, FR2, NFR3).

design.md 2.4 calls this a `TemporalEdgeStore`: a hash map keyed by edge id
plus per-node adjacency lists, replacing PyG's static `edge_index` tensor
model so edges can be dynamically inserted/removed without rebuilding the
whole tensor graph on every step. `to_pyg_edge_index()` is the "compatible
with PyTorch Geometric" surface (design.md 2.4/tech-stack note): a snapshot
of the *current* live state in the tensor shape PyG expects, so it reflects
"dynamic dropping of edges during the forward pass" -- a pruned edge is
simply absent from the next snapshot.

Backlog B.10: the `edge_index` columns are maintained incrementally, in step
with every `upsert`/`remove` (swap-with-last on removal, so both stay O(1)
apart from relabelling a moved node's edges), instead of being rebuilt from
the hash map on every pass. B.7's benchmark found that rebuild dominated the
scheduled pass above ~1k edges (134 ms of a 250 ms pass at 100k edges). A
snapshot is now an array copy. `in_subgraph()` serves the motif fast path
(tgnn.py, 5.3): the k-hop incoming neighborhood of a few nodes, built from
the adjacency sets without touching the rest of the graph.

Thread-safety: a single `RLock` guards all mutations (`upsert`/`remove`) and
snapshot reads (`edges()`/`to_pyg_edge_index()`/`in_subgraph()`), each held
only for the duration of an in-memory operation -- never across external
I/O -- so the Pruning Watcher (tasks.md 2.2) running on a background thread
does not hold this lock while writing to cold storage (see pruning.py),
keeping reads (the T-GNN inference path, tasks.md 2.6/FR2.5) from stalling
on a slow prune cycle.
"""

from __future__ import annotations

import threading
from array import array
from collections import defaultdict
from typing import Callable, Iterable, Optional

import torch

from t_gnn.schema import Edge
from t_gnn.sharding import stable_shard_index

PygGraph = tuple[torch.Tensor, list[str], dict[str, int]]


def _empty_graph() -> PygGraph:
    return torch.empty((2, 0), dtype=torch.long), [], {}


def build_in_subgraph(
    targets: Iterable[str],
    num_hops: int,
    has_node: Callable[[str], bool],
    incoming_edges: Callable[[str], list[Edge]],
) -> PygGraph:
    """The `num_hops`-hop *incoming* neighborhood of `targets`, as a small
    PyG graph with its own local node indices (Backlog B.10).

    PyG message passing (`flow="source_to_target"`, `SAGEConv`'s default)
    updates a node from the sources of its incoming edges, so an L-layer
    model's output for a target depends only on the edges into nodes fewer
    than L hops upstream of it. This collects exactly those edges, which
    makes an L-layer forward pass over the result give the targets the same
    scores as one over the whole graph, at a cost set by the neighborhood
    rather than the graph. Targets that aren't live nodes are skipped. In
    the returned node_index, dict order is index order, targets first.
    """
    node_index: dict[str, int] = {}
    frontier: list[str] = []
    for node_id in targets:
        if node_id not in node_index and has_node(node_id):
            node_index[node_id] = len(node_index)
            frontier.append(node_id)

    src_indices: list[int] = []
    dst_indices: list[int] = []
    edge_ids: list[str] = []
    for _ in range(num_hops):
        next_frontier: list[str] = []
        for node_id in frontier:
            for edge in incoming_edges(node_id):
                if edge.src not in node_index:
                    node_index[edge.src] = len(node_index)
                    next_frontier.append(edge.src)
                src_indices.append(node_index[edge.src])
                dst_indices.append(node_index[node_id])
                edge_ids.append(edge.edge_id)
        frontier = next_frontier

    if not node_index:
        return _empty_graph()
    edge_index = torch.tensor([src_indices, dst_indices], dtype=torch.long).reshape(2, -1)
    return edge_index, edge_ids, node_index


class ActiveGraphStore:
    """In-memory, dynamically mutable edge store keyed by edge id."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._edges: dict[str, Edge] = {}
        self._outgoing: dict[str, set[str]] = defaultdict(set)  # node_id -> edge_ids where node is src
        self._incoming: dict[str, set[str]] = defaultdict(set)  # node_id -> edge_ids where node is dst
        # B.10's incremental edge_index. Column c is edge _col_edge_ids[c],
        # from node slot _src_col[c] to node slot _dst_col[c]; node slot i is
        # _node_ids[i]. Both stay dense (0..n-1) via swap-with-last removal.
        self._src_col = array("q")
        self._dst_col = array("q")
        self._col_edge_ids: list[str] = []
        self._edge_col: dict[str, int] = {}
        self._node_ids: list[str] = []
        self._node_slot: dict[str, int] = {}

    def upsert(self, edge: Edge) -> None:
        """Insert a new edge, or replace an existing one with the same edge_id."""
        edge_id, src, dst = edge.edge_id, edge.src, edge.dst
        with self._lock:
            existing = self._edges.get(edge_id)
            if existing is not None:
                if existing.src == src and existing.dst == dst:
                    self._edges[edge_id] = edge  # same column, new weight/fields
                    return
                self._detach(existing)
            self._edges[edge_id] = edge
            self._outgoing[src].add(edge_id)
            self._incoming[dst].add(edge_id)
            self._edge_col[edge_id] = len(self._col_edge_ids)
            self._col_edge_ids.append(edge_id)
            # _slot_for() inlined: this is the per-edge ingest path (NFR2)
            node_slot = self._node_slot
            src_slot = node_slot.get(src)
            if src_slot is None:
                src_slot = self._slot_for(src)
            dst_slot = node_slot.get(dst)
            if dst_slot is None:
                dst_slot = self._slot_for(dst)
            self._src_col.append(src_slot)
            self._dst_col.append(dst_slot)

    def remove(self, edge_id: str) -> Optional[Edge]:
        """Remove an edge by id, returning it if present (None if already gone)."""
        with self._lock:
            edge = self._edges.pop(edge_id, None)
            if edge is not None:
                self._detach(edge)
            return edge

    def _slot_for(self, node_id: str) -> int:
        slot = self._node_slot.get(node_id)
        if slot is None:
            slot = len(self._node_ids)
            self._node_slot[node_id] = slot
            self._node_ids.append(node_id)
        return slot

    def _detach(self, edge: Edge) -> None:
        """Remove edge_id from adjacency sets and its edge_index column,
        pruning now-empty node entries."""
        col = self._edge_col.pop(edge.edge_id)
        last = len(self._col_edge_ids) - 1
        if col != last:
            moved = self._col_edge_ids[last]
            self._col_edge_ids[col] = moved
            self._src_col[col] = self._src_col[last]
            self._dst_col[col] = self._dst_col[last]
            self._edge_col[moved] = col
        self._col_edge_ids.pop()
        self._src_col.pop()
        self._dst_col.pop()

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
        if edge.src not in self._outgoing and edge.src not in self._incoming:
            self._free_slot(edge.src)
        if edge.dst != edge.src and edge.dst not in self._outgoing and edge.dst not in self._incoming:
            self._free_slot(edge.dst)

    def _free_slot(self, node_id: str) -> None:
        """Drop a node with no edges left. The last slot's node moves into
        the gap, and only that node's own columns are relabelled."""
        slot = self._node_slot.pop(node_id)
        last = len(self._node_ids) - 1
        if slot != last:
            moved = self._node_ids[last]
            self._node_ids[slot] = moved
            self._node_slot[moved] = slot
            for eid in self._outgoing.get(moved, ()):
                self._src_col[self._edge_col[eid]] = slot
            for eid in self._incoming.get(moved, ()):
                self._dst_col[self._edge_col[eid]] = slot
        self._node_ids.pop()

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

    def has_node(self, node_id: str) -> bool:
        with self._lock:
            return node_id in self._node_slot

    def incoming_edges(self, node_id: str) -> list[Edge]:
        """Active edges whose dst is `node_id`."""
        with self._lock:
            return [self._edges[eid] for eid in self._incoming.get(node_id, ())]

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

    def to_pyg_edge_index(self) -> PygGraph:
        """Snapshot of the current live graph as a PyTorch Geometric edge_index.

        Returns (edge_index, edge_ids, node_index):
          - edge_index: torch.LongTensor of shape [2, E] (row 0 = src node
            indices, row 1 = dst node indices), matching PyG's convention.
          - edge_ids: length-E list of edge ids, column-aligned with edge_index.
          - node_index: node id -> integer index used in edge_index, covering
            exactly the nodes with at least one live edge. Dict order is
            index order (0..N-1), so `list(node_index)` lines up with rows.

        The arrays are maintained incrementally (B.10), so this costs an
        array copy rather than a rebuild. Indices are stable while a node
        stays live but can change when another node is dropped, so don't
        carry them across calls: map through node ids, as tgnn.py's
        `EntityFeatureTable` does.
        """
        with self._lock:
            if not self._col_edge_ids:
                return _empty_graph()
            src = torch.frombuffer(self._src_col, dtype=torch.long)
            dst = torch.frombuffer(self._dst_col, dtype=torch.long)
            edge_index = torch.stack([src, dst])  # a copy, independent of the arrays
            del src, dst  # release the arrays' buffers so they can grow again
            edge_ids = list(self._col_edge_ids)
            node_index = dict(zip(self._node_ids, range(len(self._node_ids))))
        return edge_index, edge_ids, node_index

    def in_subgraph(self, targets: Iterable[str], num_hops: int) -> PygGraph:
        """The k-hop incoming neighborhood of `targets` (B.10's motif fast
        path) -- see `build_in_subgraph()`. One consistent snapshot: the
        store's lock is held for the whole walk."""
        with self._lock:
            return build_in_subgraph(targets, num_hops, self.has_node, self.incoming_edges)


class ShardedActiveGraphStore:
    """Edge-partitioned distribution of `ActiveGraphStore` across N shards
    (tasks.md Backlog B.5, proposal.docx §7's "distributing the active
    graph ... across multiple nodes to support even larger deployments").

    Partitions by edge id (`stable_shard_index()` over `edge.edge_id`, not
    node id) -- a deliberately simple scheme: every edge lives on exactly
    one shard, and `edge_id` alone (already a stable hash, `schema.py`'s
    `make_edge_id()`) determines which one, so `upsert`/`remove`/`get` never
    need a cross-shard directory to find the right shard. The tradeoff is
    that node-centric queries (`neighbors()`, `to_pyg_edge_index()`) fan out
    to every shard and merge results -- a real, if less efficient,
    distributed-systems pattern (scatter-gather), in exchange for not
    needing a node-to-shard directory service a vertex-partitioned scheme
    would require.

    Each shard is an ordinary `ActiveGraphStore`. In a genuinely distributed
    deployment these would be separate processes/machines behind some RPC
    layer; here they are in-process -- the same relationship
    `InMemoryColdStorageWriter` has to a real distributed writer, except
    here the partitioning/routing logic itself is real and directly
    tested, not a fake standing in for one.
    """

    def __init__(self, num_shards: int) -> None:
        if num_shards < 1:
            raise ValueError("num_shards must be >= 1")
        self.num_shards = num_shards
        self.shards: list[ActiveGraphStore] = [ActiveGraphStore() for _ in range(num_shards)]

    def shard_for(self, edge_id: str) -> ActiveGraphStore:
        return self.shards[stable_shard_index(edge_id, self.num_shards)]

    def upsert(self, edge: Edge) -> None:
        self.shard_for(edge.edge_id).upsert(edge)

    def remove(self, edge_id: str) -> Optional[Edge]:
        return self.shard_for(edge_id).remove(edge_id)

    def get(self, edge_id: str) -> Optional[Edge]:
        return self.shard_for(edge_id).get(edge_id)

    def edges(self) -> list[Edge]:
        result: list[Edge] = []
        for shard in self.shards:
            result.extend(shard.edges())
        return result

    def __len__(self) -> int:
        return sum(len(shard) for shard in self.shards)

    def neighbors(self, node_id: str, direction: str = "out") -> list[str]:
        """Scatter-gather across every shard -- see class docstring for why
        this can't be routed to a single shard the way edge-keyed
        operations are."""
        result: list[str] = []
        for shard in self.shards:
            result.extend(shard.neighbors(node_id, direction=direction))
        return result

    def has_node(self, node_id: str) -> bool:
        return any(shard.has_node(node_id) for shard in self.shards)

    def incoming_edges(self, node_id: str) -> list[Edge]:
        result: list[Edge] = []
        for shard in self.shards:
            result.extend(shard.incoming_edges(node_id))
        return result

    def to_pyg_edge_index(self) -> PygGraph:
        """Merges every shard's live edges into one combined edge_index --
        same return shape as `ActiveGraphStore.to_pyg_edge_index()`, so this
        is a drop-in graph source for `DynamicTGNN.score_entities()`
        (tgnn.py, Phase 5). Each shard's snapshot is relabelled into one
        global node index with a tensor lookup, not a per-edge loop (B.10)."""
        node_index: dict[str, int] = {}
        parts: list[torch.Tensor] = []
        edge_ids: list[str] = []
        for shard in self.shards:
            shard_index, shard_edge_ids, shard_nodes = shard.to_pyg_edge_index()
            if not shard_edge_ids:
                continue
            to_global = torch.tensor(
                [node_index.setdefault(node_id, len(node_index)) for node_id in shard_nodes], dtype=torch.long
            )
            parts.append(to_global[shard_index])
            edge_ids.extend(shard_edge_ids)
        if not parts:
            return _empty_graph()
        return torch.cat(parts, dim=1), edge_ids, node_index

    def in_subgraph(self, targets: Iterable[str], num_hops: int) -> PygGraph:
        """Scatter-gather version of `ActiveGraphStore.in_subgraph()`. Unlike
        the single store it isn't one atomic snapshot: each shard is read
        separately, so concurrent writes can land between hops."""
        return build_in_subgraph(targets, num_hops, self.has_node, self.incoming_edges)
