"""Stateful Motif Caching engine (tasks.md 3.2-3.7, FR3, design.md 2.6).

design.md 2.6's three-field motif-state record (`stage`, `last_edge_ts`,
`matched_edges`) is `MotifState` below, plus `started_at` -- an obvious
extension of the same idea (the window bound in FR3.1 is measured from the
*first* matched edge, not the most recent one; for the two seed motifs,
which are both two-step, `last_edge_ts` before the final hop already equals
`started_at`, but tracking it explicitly keeps the window check correct for
any future motif with more than two steps).

**Delta-update algorithm (3.4, design.md 2.6):** `MotifEngine.on_edge()`
does no graph traversal and no scan of existing state. For each motif
definition:
  1. If the edge matches step 0's shape, it may start a *new* candidate
     chain, keyed by `steps[0].candidate_key(edge)` (motifs.py). A fresh
     state is only created if none already exists at that key (an
     in-progress chain is never clobbered by an unrelated step-0-shaped
     edge arriving at the same key).
  2. If the edge matches step `stage`'s shape for stage in
     `1..len(steps)-1`, `steps[stage].candidate_key(edge)` gives the exact
     Redis/dict key to look up (O(1), no scan) the state it would advance,
     *if* that state exists and is currently sitting at `stage`.
  3. A candidate advance is rejected if the edge is older than the state's
     last matched edge (steps must move forward in time) or if it would
     land outside the motif's `window_seconds` measured from `started_at`
     -- the state is dropped in the latter case rather than left for the
     TTL to eventually catch, since we've just proven it is already stale.
  4. Reaching `final_stage` emits a `MotifCompletionEvent` (3.5) and clears
     the state; otherwise the advanced state is written back with a fresh
     TTL (3.7).

**Motif reset-on-prune (3.6):** `MotifEngine.on_prune()` is a
`PrunedEdgeEvent` subscriber (see pruning.py's `PruneEventBus`) --
constructing a `MotifEngine` with `prune_event_bus` set wires this
automatically. It asks the state store for every state whose
`matched_edges` contains the pruned edge id (`states_containing_edge`,
backed by a reverse index so this is also O(1)-ish rather than a scan) and
deletes them, directly implementing FR3.3 / design.md 2.6's "Motif reset on
prune" bullet.

**TTL as an independent safety net (3.7):** `RedisMotifStateStore.set()`
always applies `EXPIRE` for `window_seconds`, and `InMemoryMotifStateStore`
(used in unit tests without a live Redis) tracks the same expiry against an
injectable clock -- so a missed/lost prune event can never leave a stale
partial match alive indefinitely, independent of 3.6's explicit path.

**Graceful degradation on Redis outage (tasks.md 6.3, NFR4, design.md
§5's "Redis unavailable" failure mode):** every `state_store` call inside
`MotifEngine` goes through `_state_get`/`_state_set`/`_state_delete`/
`_state_containing_edge`, which catch `redis.exceptions.RedisError` rather
than letting it propagate. On failure, `self.available` flips to `False`
(logged once, not per edge, to avoid log spam under a sustained outage) and
the call site treats it as "no match" -- `on_edge()`/`on_prune()` simply
stop finding or creating motif state until Redis comes back, at which
point the next successful call flips `self.available` back to `True` and
detection silently resumes. Nothing here touches `BaselineStore`/
`DecayEngine`/`TGNNInferenceEngine`, which have no Redis dependency in the
first place -- FR1.5 anomaly detection is unaffected by construction, not
because of any special-casing in this module.
"""

from __future__ import annotations

import json
import logging
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable, Optional, Protocol

from redis.exceptions import RedisError

from t_gnn.motifs import MotifDefinition, MotifStep
from t_gnn.pruning import PruneEventBus, PrunedEdgeEvent
from t_gnn.schema import Edge
from t_gnn.sharding import stable_shard_index

logger = logging.getLogger(__name__)


@dataclass
class MotifState:
    motif_name: str
    chain_key: str
    stage: int
    started_at: float
    last_edge_ts: float
    matched_edges: list[str] = field(default_factory=list)
    # Cumulative match confidence (tasks.md Backlog B.4): the running
    # product of each matched step's MotifStep.match_score(). Always 1.0
    # when MotifEngine isn't running in fuzzy mode, since every step there
    # is required to match exactly (score 1.0).
    confidence: float = 1.0


class MotifStateStore(Protocol):
    def get(self, motif_name: str, chain_key: str) -> Optional[MotifState]: ...
    def set(self, state: MotifState, ttl_seconds: float) -> None: ...
    def delete(self, motif_name: str, chain_key: str) -> None: ...
    def states_containing_edge(self, edge_id: str) -> list[MotifState]: ...


def _state_key(motif_name: str, chain_key: str) -> tuple[str, str]:
    return (motif_name, chain_key)


class InMemoryMotifStateStore:
    """Fake `MotifStateStore` (no Redis dependency) for unit-testing the
    motif engine's delta-update/reset/TTL logic in isolation, mirroring
    cold_storage.py's `InMemoryColdStorageWriter`.

    TTL is evaluated against an injectable clock (default `time.time`)
    rather than relying on wall-clock sleeps, the same testability pattern
    `decay.py`/`pruning.py` use with an explicit `t` parameter.
    """

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._states: dict[tuple[str, str], tuple[MotifState, float]] = {}
        self._edge_index: dict[str, set[tuple[str, str]]] = defaultdict(set)

    def get(self, motif_name: str, chain_key: str) -> Optional[MotifState]:
        key = _state_key(motif_name, chain_key)
        entry = self._states.get(key)
        if entry is None:
            return None
        state, expires_at = entry
        if self._clock() >= expires_at:
            self._remove(key)
            return None
        return state

    def set(self, state: MotifState, ttl_seconds: float) -> None:
        key = _state_key(state.motif_name, state.chain_key)
        self._remove(key)
        self._states[key] = (state, self._clock() + ttl_seconds)
        for edge_id in state.matched_edges:
            self._edge_index[edge_id].add(key)

    def delete(self, motif_name: str, chain_key: str) -> None:
        self._remove(_state_key(motif_name, chain_key))

    def states_containing_edge(self, edge_id: str) -> list[MotifState]:
        now = self._clock()
        result = []
        for key in list(self._edge_index.get(edge_id, set())):
            entry = self._states.get(key)
            if entry is None:
                self._edge_index[edge_id].discard(key)
                continue
            state, expires_at = entry
            if now >= expires_at:
                self._remove(key)
                continue
            result.append(state)
        return result

    def _remove(self, key: tuple[str, str]) -> None:
        entry = self._states.pop(key, None)
        if entry is None:
            return
        for edge_id in entry[0].matched_edges:
            self._edge_index[edge_id].discard(key)


class RedisMotifStateStore:
    """Real `MotifStateStore` backed by Redis (design.md 2.6/tasks.md 3.3),
    against docker-compose.yml's now-running Redis instance.

    Each state is a Redis hash `motif:state:{motif_name}:{chain_key}` with
    an `EXPIRE` of the motif's `window_seconds` set/refreshed on every write
    (3.7). The reverse index used for reset-on-prune (3.6) is a Redis set
    per edge id, `motif:edge_index:{edge_id}` -> {"{motif_name}:{chain_key}"},
    carrying the same TTL so it never outlives the state it points at.
    """

    _STATE_PREFIX = "motif:state:"
    _EDGE_INDEX_PREFIX = "motif:edge_index:"

    def __init__(self, client) -> None:
        self._client = client

    @staticmethod
    def _state_redis_key(motif_name: str, chain_key: str) -> str:
        return f"{RedisMotifStateStore._STATE_PREFIX}{motif_name}:{chain_key}"

    @staticmethod
    def _edge_index_redis_key(edge_id: str) -> str:
        return f"{RedisMotifStateStore._EDGE_INDEX_PREFIX}{edge_id}"

    def get(self, motif_name: str, chain_key: str) -> Optional[MotifState]:
        raw = self._client.hgetall(self._state_redis_key(motif_name, chain_key))
        if not raw:
            return None
        # confidence (tasks.md Backlog B.4) defaults to 1.0 for states
        # written before this field existed, so an older Redis record
        # round-trips as an exact (non-fuzzy) match rather than erroring.
        confidence_raw = raw.get(b"confidence", raw.get("confidence", 1.0))
        return MotifState(
            motif_name=motif_name,
            chain_key=chain_key,
            stage=int(raw[b"stage"] if b"stage" in raw else raw["stage"]),
            started_at=float(raw[b"started_at"] if b"started_at" in raw else raw["started_at"]),
            last_edge_ts=float(raw[b"last_edge_ts"] if b"last_edge_ts" in raw else raw["last_edge_ts"]),
            matched_edges=json.loads(raw[b"matched_edges"] if b"matched_edges" in raw else raw["matched_edges"]),
            confidence=float(confidence_raw),
        )

    def set(self, state: MotifState, ttl_seconds: float) -> None:
        self.delete(state.motif_name, state.chain_key)
        state_key = self._state_redis_key(state.motif_name, state.chain_key)
        ttl = max(1, int(ttl_seconds))
        self._client.hset(
            state_key,
            mapping={
                "stage": state.stage,
                "started_at": state.started_at,
                "last_edge_ts": state.last_edge_ts,
                "matched_edges": json.dumps(state.matched_edges),
                "confidence": state.confidence,
            },
        )
        self._client.expire(state_key, ttl)
        member = f"{state.motif_name}:{state.chain_key}"
        for edge_id in state.matched_edges:
            index_key = self._edge_index_redis_key(edge_id)
            self._client.sadd(index_key, member)
            self._client.expire(index_key, ttl)

    def delete(self, motif_name: str, chain_key: str) -> None:
        existing = self.get(motif_name, chain_key)
        self._client.delete(self._state_redis_key(motif_name, chain_key))
        if existing is not None:
            member = f"{motif_name}:{chain_key}"
            for edge_id in existing.matched_edges:
                self._client.srem(self._edge_index_redis_key(edge_id), member)

    def states_containing_edge(self, edge_id: str) -> list[MotifState]:
        members = self._client.smembers(self._edge_index_redis_key(edge_id))
        result = []
        for member in members:
            member = member.decode("utf-8") if isinstance(member, bytes) else member
            motif_name, _, chain_key = member.partition(":")
            state = self.get(motif_name, chain_key)
            if state is not None:
                result.append(state)
        return result


class ShardedMotifStateStore:
    """Distributes motif state across N underlying `MotifStateStore`
    instances (tasks.md Backlog B.5, proposal.docx §7's "distributing ...
    the pattern cache across multiple nodes"). In a genuinely multi-node
    deployment, `shards` would be N `RedisMotifStateStore`s each pointed at
    a different Redis host/db; `InMemoryMotifStateStore` shards work the
    same way for tests.

    Routes by `chain_key` (via `stable_shard_index()`, sharding.py) since
    `get`/`set`/`delete` already address state by `(motif_name, chain_key)`.
    `states_containing_edge()` is the one operation that doesn't know its
    target shard in advance -- an edge id doesn't encode which chain_key's
    shard holds it -- so it fans out to every shard and merges, the same
    scatter-gather tradeoff `ShardedActiveGraphStore`'s `neighbors()`/
    `to_pyg_edge_index()` make (graph_store.py).
    """

    def __init__(self, shards: list) -> None:
        if not shards:
            raise ValueError("ShardedMotifStateStore needs at least one shard")
        self.shards = shards

    def _shard_for(self, chain_key: str) -> "MotifStateStore":
        return self.shards[stable_shard_index(chain_key, len(self.shards))]

    def get(self, motif_name: str, chain_key: str) -> Optional[MotifState]:
        return self._shard_for(chain_key).get(motif_name, chain_key)

    def set(self, state: MotifState, ttl_seconds: float) -> None:
        self._shard_for(state.chain_key).set(state, ttl_seconds)

    def delete(self, motif_name: str, chain_key: str) -> None:
        self._shard_for(chain_key).delete(motif_name, chain_key)

    def states_containing_edge(self, edge_id: str) -> list[MotifState]:
        result: list[MotifState] = []
        for shard in self.shards:
            result.extend(shard.states_containing_edge(edge_id))
        return result


@dataclass
class MotifCompletionEvent:
    """FR3.4: a high-confidence alert distinct from the statistical anomaly
    signal (FR1.5), emitted when a motif reaches its final stage."""

    motif_name: str
    chain_key: str
    matched_edges: list[str]
    completed_at: float
    # Cumulative match confidence (tasks.md Backlog B.4) -- 1.0 unless
    # MotifEngine was constructed with fuzzy=True and at least one matched
    # step was a partial (not exact) match.
    confidence: float = 1.0


class MotifAlertBus:
    """In-process pub/sub for motif-completion alerts, the same standing-in
    role `pruning.py`'s `PruneEventBus` plays for prune events -- the real
    Alert/Signal Bus (design.md's architecture diagram) is downstream
    infrastructure Phase 5's T-GNN integration will consume from."""

    def __init__(self) -> None:
        self._subscribers: list[Callable[[MotifCompletionEvent], None]] = []

    def subscribe(self, callback: Callable[[MotifCompletionEvent], None]) -> None:
        self._subscribers.append(callback)

    def publish(self, event: MotifCompletionEvent) -> None:
        for callback in self._subscribers:
            callback(event)


@dataclass
class MotifResetEvent:
    """tasks.md 3.6/3.3, and 6.1/6.2's audit-log and metrics consumers:
    published whenever a partial match is reset because one of its
    contributing edges was pruned (FR3.3)."""

    motif_name: str
    chain_key: str
    triggering_edge_id: str
    matched_edges: list[str]
    reset_at: float


class MotifResetBus:
    """In-process pub/sub for motif-reset events -- the same standing-in
    role `MotifAlertBus`/`PruneEventBus` play. Introduced in 6.1/6.2
    because reset events now have two real subscribers (the audit logger
    and the metrics collector), not because every event needs its own bus
    on principle."""

    def __init__(self) -> None:
        self._subscribers: list[Callable[[MotifResetEvent], None]] = []

    def subscribe(self, callback: Callable[[MotifResetEvent], None]) -> None:
        self._subscribers.append(callback)

    def publish(self, event: MotifResetEvent) -> None:
        for callback in self._subscribers:
            callback(event)


class MotifEngine:
    """Generic motif cache + delta-update engine, generalized over any
    `MotifDefinition` (FR3.1's "SHALL generalize to any operator-defined
    motif").

    `fuzzy`/`min_confidence` (tasks.md Backlog B.4, proposal.docx §7):
    when `fuzzy=False` (the default), every step must match
    `MotifStep.matches_shape()` exactly, identical to the engine's
    original behavior -- `min_confidence` is irrelevant here since only
    already-exact (confidence 1.0) chains ever reach the final stage.
    When `fuzzy=True`, steps are matched via `MotifStep.match_score()`
    instead: a structural-role mismatch (wrong `src_type`/`dst_type`, or
    every specified `edge_type`/`protocol` missed) still rejects outright,
    but a partial match on `edge_type`/`protocol` advances the chain with
    a confidence penalty. A completion only fires once the chain's
    cumulative confidence (the running product of each step's score)
    clears `min_confidence` at the final stage -- otherwise the state is
    dropped rather than left to complete on a later edge, since additional
    steps can only ever decrease (never recover) that product.
    """

    def __init__(
        self,
        definitions: list[MotifDefinition],
        state_store: MotifStateStore,
        alert_bus: Optional[MotifAlertBus] = None,
        prune_event_bus: Optional[PruneEventBus] = None,
        reset_bus: Optional[MotifResetBus] = None,
        fuzzy: bool = False,
        min_confidence: float = 0.5,
    ) -> None:
        self.definitions = definitions
        self.state_store = state_store
        self.alert_bus = alert_bus or MotifAlertBus()
        self.reset_bus = reset_bus or MotifResetBus()
        self.fuzzy = fuzzy
        self.min_confidence = min_confidence
        self.available = True
        if prune_event_bus is not None:
            prune_event_bus.subscribe(self.on_prune)

    def on_edge(self, edge: Edge) -> list[MotifCompletionEvent]:
        events: list[MotifCompletionEvent] = []
        for definition in self.definitions:
            self._try_start(definition, edge)
            event = self._try_advance(definition, edge)
            if event is not None:
                events.append(event)
        return events

    def _step_score(self, step: MotifStep, edge: Edge) -> Optional[float]:
        """1.0/None in exact mode (identical to the pre-B.4 behavior);
        `MotifStep.match_score()`'s partial-credit score in fuzzy mode."""
        if not self.fuzzy:
            return 1.0 if step.matches_shape(edge) else None
        return step.match_score(edge)

    def _try_start(self, definition: MotifDefinition, edge: Edge) -> None:
        step0 = definition.steps[0]
        score = self._step_score(step0, edge)
        if score is None:
            return
        key = step0.candidate_key(edge)
        if key is None:
            return
        if self._state_get(definition.name, key) is not None:
            return  # don't clobber an in-progress chain at this key
        if definition.final_stage == 1:
            # A single-step "motif" completes immediately -- not used by the
            # current seed motifs, but a valid degenerate case of the schema.
            if score < self.min_confidence:
                return
            self.alert_bus.publish(
                MotifCompletionEvent(
                    motif_name=definition.name,
                    chain_key=key,
                    matched_edges=[edge.edge_id],
                    completed_at=edge.t_e,
                    confidence=score,
                )
            )
            return
        state = MotifState(
            motif_name=definition.name,
            chain_key=key,
            stage=1,
            started_at=edge.t_e,
            last_edge_ts=edge.t_e,
            matched_edges=[edge.edge_id],
            confidence=score,
        )
        self._state_set(state, ttl_seconds=definition.window_seconds)

    def _try_advance(self, definition: MotifDefinition, edge: Edge) -> Optional[MotifCompletionEvent]:
        for stage in range(1, definition.final_stage):
            step = definition.steps[stage]
            score = self._step_score(step, edge)
            if score is None:
                continue
            key = step.candidate_key(edge)
            if key is None:
                continue
            state = self._state_get(definition.name, key)
            if state is None or state.stage != stage:
                continue
            if edge.t_e < state.last_edge_ts:
                continue
            if edge.t_e - state.started_at > definition.window_seconds:
                logger.info(
                    "motif %s candidate %s exceeded its %.0fs window; dropping stale partial match",
                    definition.name, key, definition.window_seconds,
                )
                self._state_delete(definition.name, key)
                continue

            new_stage = stage + 1
            matched_edges = state.matched_edges + [edge.edge_id]
            confidence = state.confidence * score
            if new_stage >= definition.final_stage:
                self._state_delete(definition.name, key)
                if confidence < self.min_confidence:
                    # Fuzzy mode only (exact mode's score is always 1.0, so
                    # this branch is unreachable there): structurally
                    # completed, but too much accumulated protocol/edge-type
                    # deviation to trust as a real match (tasks.md Backlog
                    # B.4) -- dropped, not reported.
                    logger.info(
                        "motif %s candidate %s reached final stage but confidence %.3f < min_confidence %.3f; dropping",
                        definition.name, key, confidence, self.min_confidence,
                    )
                    continue
                event = MotifCompletionEvent(
                    motif_name=definition.name,
                    chain_key=key,
                    matched_edges=matched_edges,
                    completed_at=edge.t_e,
                    confidence=confidence,
                )
                self.alert_bus.publish(event)
                return event

            advanced = MotifState(
                motif_name=definition.name,
                chain_key=key,
                stage=new_stage,
                started_at=state.started_at,
                last_edge_ts=edge.t_e,
                matched_edges=matched_edges,
                confidence=confidence,
            )
            self._state_set(advanced, ttl_seconds=definition.window_seconds)
            return None
        return None

    def on_prune(self, event: PrunedEdgeEvent) -> None:
        """FR3.3/3.6: reset any partial motif match that depended on an edge
        just severed from active memory, before it could complete."""
        for state in self._state_containing_edge(event.edge.edge_id):
            self._state_delete(state.motif_name, state.chain_key)
            logger.info(
                "motif %s candidate %s reset: contributing edge %s was pruned",
                state.motif_name, state.chain_key, event.edge.edge_id,
            )
            self.reset_bus.publish(
                MotifResetEvent(
                    motif_name=state.motif_name,
                    chain_key=state.chain_key,
                    triggering_edge_id=event.edge.edge_id,
                    matched_edges=state.matched_edges,
                    reset_at=event.pruned_at,
                )
            )

    # --- 6.3: Redis-outage graceful degradation -----------------------------

    def _mark_degraded(self) -> None:
        if self.available:
            logger.error(
                "motif state store unreachable -- motif detection degraded "
                "(disabled, best-effort) until it recovers; FR1.5 anomaly "
                "detection is unaffected",
                exc_info=True,
            )
        self.available = False

    def _mark_recovered(self) -> None:
        if not self.available:
            logger.info("motif state store reachable again -- motif detection resumed")
        self.available = True

    def _state_get(self, motif_name: str, chain_key: str) -> Optional[MotifState]:
        try:
            result = self.state_store.get(motif_name, chain_key)
        except RedisError:
            self._mark_degraded()
            return None
        self._mark_recovered()
        return result

    def _state_set(self, state: MotifState, ttl_seconds: float) -> None:
        try:
            self.state_store.set(state, ttl_seconds)
        except RedisError:
            self._mark_degraded()
            return
        self._mark_recovered()

    def _state_delete(self, motif_name: str, chain_key: str) -> None:
        try:
            self.state_store.delete(motif_name, chain_key)
        except RedisError:
            self._mark_degraded()
            return
        self._mark_recovered()

    def _state_containing_edge(self, edge_id: str) -> list[MotifState]:
        try:
            result = self.state_store.states_containing_edge(edge_id)
        except RedisError:
            self._mark_degraded()
            return []
        self._mark_recovered()
        return result
