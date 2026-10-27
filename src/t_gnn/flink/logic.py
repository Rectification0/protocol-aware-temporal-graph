"""Per-record logic and wire formats for the Flink decay/baseline job (Backlog B.1).

Everything here is plain Python over the existing decay.py/baseline.py
functions, so the job's operators stay thin wrappers and this module is
testable without PyFlink (which can't be installed on the host's Python 3.12).

Topics and record shapes (all values are JSON strings):

- `EDGES_TOPIC` (in): `Edge.to_json()`, keyed by `edge.src`. The job re-keys
  by `baseline_key()` (entity, protocol) -- Backlog B.11.
- `LAMBDAS_TOPIC` (in, compacted, broadcast to every task): one record per
  protocol, keyed by protocol -- `{"protocol", "lambda_p", "published_at"}`.
  `DEFAULT_PROTOCOL_KEY` carries `default_lambda_p`, the fallback for a
  protocol with no entry, matching `ProtocolDecayRegistry.get()`.
- `DECAYED_TOPIC` (out): one record per input edge --
  `{"edge": <edge refreshed at t_e>, "deviation": <DeviationSignal>}`,
  i.e. exactly what `DecayStreamProcessor.process(edge, t=edge.t_e)` returns.
- `WEIGHTS_TOPIC` (out): the timer-driven re-evaluations of design.md 2.1 --
  `{"edge_id", "src", "dst", "protocol", "t", "w", "lambda_p", "expired"}`.
"""

from __future__ import annotations

import dataclasses
import json
import math
from typing import Mapping, Optional

from t_gnn.baseline import DEFAULT_ALPHA, DeviationSignal, EWMABaseline, observe_baseline
from t_gnn.decay import compute_weight
from t_gnn.protocol_registry import ProtocolDecayRegistry
from t_gnn.schema import Edge

EDGES_TOPIC = "t-gnn.edges.raw"
LAMBDAS_TOPIC = "t-gnn.decay.lambdas"
DECAYED_TOPIC = "t-gnn.edges.decayed"
WEIGHTS_TOPIC = "t-gnn.edges.weights"

DEFAULT_PROTOCOL_KEY = "*"
JOB_NAME = "t-gnn-decay-baseline"


def lambda_records(registry: ProtocolDecayRegistry, published_at: float) -> list[tuple[str, str]]:
    """(key, value) pairs publishing every lambda_p in `registry`, default included."""
    pairs = [(DEFAULT_PROTOCOL_KEY, registry.lambda_for(DEFAULT_PROTOCOL_KEY))]
    pairs += [(protocol, registry.lambda_for(protocol)) for protocol in registry.protocols]
    return [
        (key, json.dumps({"protocol": key, "lambda_p": lambda_p, "published_at": published_at}))
        for key, lambda_p in pairs
    ]


def parse_lambda_record(value: str) -> tuple[str, float]:
    record = json.loads(value)
    return record["protocol"], float(record["lambda_p"])


def resolve_lambda(lambdas: Mapping[str, float], protocol: str) -> Optional[float]:
    """The broadcast-state lookup: the protocol's own lambda_p, else the
    published default, else None (nothing published yet -- the caller holds
    the edge until something is)."""
    if protocol in lambdas:
        return lambdas[protocol]
    return lambdas.get(DEFAULT_PROTOCOL_KEY)


def to_millis(t: float) -> int:
    return int(round(t * 1000))


def refresh_at_ingest(edge: Edge, lambda_p: float) -> Edge:
    """`DecayEngine.refresh(edge, t=edge.t_e)` with lambda_p supplied by the caller."""
    return dataclasses.replace(edge, w=compute_weight(edge.w_0, lambda_p, edge.t_e, edge.t_e), w_evaluated_at=edge.t_e)


def expiry_time(edge: Edge, lambda_p: float, expire_below: float) -> float:
    """When w(e,t) falls to `expire_below` -- `inf` if it never does (lambda_p <= 0)
    or the edge already starts at/below it (then: t_e)."""
    if edge.w_0 <= expire_below:
        return edge.t_e
    if lambda_p <= 0.0:
        return math.inf
    return edge.t_e + math.log(edge.w_0 / expire_below) / lambda_p


def next_refresh_time(edge: Edge, t: float, lambda_p: float, interval: float, expire_below: float) -> float:
    """The next re-evaluation after `t`: one interval on, or the expiry
    moment if that comes first, so the expiring refresh lands exactly on it."""
    return min(t + interval, max(t, expiry_time(edge, lambda_p, expire_below)))


def weight_record(edge: Edge, t: float, lambda_p: float, expire_below: float) -> tuple[dict, bool]:
    """Re-evaluate w(e,t) at `t` (design.md 2.1's timer); returns (record, expired)."""
    w = compute_weight(edge.w_0, lambda_p, edge.t_e, t)
    # Judged by time, not weight: the timer fires at the millisecond nearest
    # expiry_time(), so w there may sit a hair above expire_below.
    expired = t >= expiry_time(edge, lambda_p, expire_below) - 0.001
    record = {
        "edge_id": edge.edge_id, "src": edge.src, "dst": edge.dst, "protocol": edge.protocol,
        "t": t, "w": w, "lambda_p": lambda_p, "expired": expired,
    }
    return record, expired


def baseline_key(edge: Edge) -> str:
    return f"{edge.src}|{edge.protocol}"


def observe_from_state(state: Optional[str], edge: Edge, alpha: float = DEFAULT_ALPHA) -> tuple[str, DeviationSignal]:
    """`BaselineStore.observe_edge()` against JSON-serialized keyed state
    (None for a key's first observation); returns (new state, signal)."""
    baseline = EWMABaseline.from_state(json.loads(state), alpha=alpha) if state else EWMABaseline(alpha=alpha)
    t = edge.w_evaluated_at if edge.w_evaluated_at is not None else edge.t_e
    signal = observe_baseline(baseline, edge.src, edge.protocol, edge.w, t)
    return json.dumps(baseline.to_state()), signal


def decayed_record(edge: Edge, signal: DeviationSignal) -> str:
    return json.dumps({"edge": edge.to_dict(), "deviation": dataclasses.asdict(signal)}, sort_keys=True)


def parse_decayed_record(value: str) -> tuple[Edge, DeviationSignal]:
    record = json.loads(value)
    return Edge.from_dict(record["edge"]), DeviationSignal(**record["deviation"])


# --- Backlog B.11: the fused decay+baseline operator, keyed by (entity, protocol) ---
#
# The job used to key the decay step by edge id, so every edge was a new key
# and keyed state never stayed hot, then re-key by `baseline_key()` for the
# baseline -- a second Python<->JVM hop per edge. Now one operator is keyed
# by `baseline_key()` and does both. Its keyed state per (entity, protocol):
# the EWMA baseline, the edges waiting for a lambda_p (in arrival order, so
# the baseline still sees them in order), and the live edges' refresh
# timers, bucketed by due time so a firing timer touches only the edges due
# then.


def raw_key(value: str) -> str:
    """`baseline_key()` straight from an edge's JSON, without building an Edge."""
    record = json.loads(value)
    return f"{record['src']}|{record['protocol']}"


def ingest_edge(edge: Edge, lambda_p: float, baseline_state: Optional[str], alpha: float = DEFAULT_ALPHA) -> tuple[str, str]:
    """Decay at ingest, then the baseline step: (new baseline state, decayed
    record). Exactly `DecayStreamProcessor.process(edge, t=edge.t_e)`."""
    refreshed = refresh_at_ingest(edge, lambda_p)
    new_state, signal = observe_from_state(baseline_state, refreshed, alpha=alpha)
    return new_state, decayed_record(refreshed, signal)


def reevaluate(edge: Edge, t: float, lambda_p: float, refresh_interval: float,
               expire_below: float) -> tuple[str, Optional[float]]:
    """A timer's re-evaluation: (weight record JSON, next refresh time, or
    None once the edge has expired or will never need another)."""
    record, expired = weight_record(edge, t, lambda_p, expire_below)
    if expired:
        return json.dumps(record), None
    next_t = next_refresh_time(edge, t, lambda_p, refresh_interval, expire_below)
    return json.dumps(record), next_t if math.isfinite(next_t) else None


def bucket_add(raw: Optional[str], edge: Edge, lambda_p: float) -> str:
    """Add an edge to the refresh bucket for one due time (JSON list)."""
    entries = json.loads(raw) if raw else []
    entries.append({"edge": edge.to_dict(), "lambda_p": lambda_p})
    return json.dumps(entries)


def bucket_entries(raw: str) -> list[tuple[Edge, float]]:
    return [(Edge.from_dict(e["edge"]), e["lambda_p"]) for e in json.loads(raw)]


def pending_add(raw: Optional[str], edge: Edge) -> str:
    """Append an edge to the key's waiting-for-lambda_p list (JSON list)."""
    entries = json.loads(raw) if raw else []
    entries.append(edge.to_dict())
    return json.dumps(entries)


def pending_edges(raw: Optional[str]) -> list[Edge]:
    return [Edge.from_dict(e) for e in json.loads(raw)] if raw else []
