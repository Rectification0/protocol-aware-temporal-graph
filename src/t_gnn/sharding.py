"""Consistent-hash sharding utility (tasks.md Backlog B.5).

design.md describes the Active Graph Store (2.4) and the Redis motif cache
(2.6) as single logical stores; proposal.docx §7 "Future Enhancements"
calls out "distributing the active graph and pattern cache across multiple
nodes to support even larger deployments." `graph_store.py`'s
`ShardedActiveGraphStore` and `motif_engine.py`'s `ShardedMotifStateStore`
both need the same primitive: a hash function that is stable *across
processes*, since Python's built-in `hash()` is salted per-process via
`PYTHONHASHSEED` -- using it here would mean one process's shard-routing
decision for a given key would disagree with another process looking up
that same key later, which is exactly the kind of bug that would only show
up once this is actually running as more than one node.
"""

from __future__ import annotations

import hashlib


def stable_shard_index(key: str, num_shards: int) -> int:
    """Deterministic shard index for `key` in `[0, num_shards)`, stable
    across processes/machines (unlike Python's randomized `hash()`)."""
    if num_shards < 1:
        raise ValueError("num_shards must be >= 1")
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % num_shards
