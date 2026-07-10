# Design: Protocol-Aware Asymmetric Decay and Stateful Motif Pruning in CTDGs

## 1. Architecture Overview

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                     Log Sources                          │
                    │   (RDP, SMB, Kerberos, DNS, ... enterprise telemetry)    │
                    └───────────────────────────┬───────────────────────────┘
                                                  │ raw events
                                                  ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │                Apache Flink (Ingestion)                  │
                    │  - Parse event → typed edge (src, dst, protocol, t_e,w_0)│
                    │  - Compute w(e,t) continuously (streaming decay job)     │
                    │  - Emit edge updates to Graph RAM + Motif Engine         │
                    └───────┬───────────────────────────────┬─────────────────┘
                            │                                │
                            ▼                                ▼
              ┌───────────────────────────┐      ┌───────────────────────────┐
              │   Active Graph (RAM)      │      │   Redis (Motif Cache)     │
              │  - PyTorch Geometric      │      │  - Partial motif states   │
              │    dynamic edge store     │◄────►│  - Delta-update on edge   │
              │  - Pruning watcher        │      │    ingest                 │
              └──────────┬────────────────┘      └──────────┬────────────────┘
                          │ w(e,t) < ε                       │ motif complete /
                          ▼                                  │ motif reset
              ┌───────────────────────────┐                  ▼
              │   Neo4j (Cold Storage)    │      ┌───────────────────────────┐
              │  - Serialized pruned      │      │   Alert / Signal Bus      │
              │    edges, forensics       │      │  - Anomaly signal         │
              └───────────────────────────┘      │  - Motif-completion signal│
                                                  └──────────┬────────────────┘
                                                             ▼
                                                  ┌───────────────────────────┐
                                                  │   T-GNN Inference Engine  │
                                                  │  (PyTorch Geometric,      │
                                                  │   customized dynamic-edge │
                                                  │   forward pass)           │
                                                  └───────────────────────────┘
```

## 2. Components

### 2.1 Ingestion Layer (Apache Flink)
- **Responsibility**: Consume raw protocol logs, normalize into typed edges, and continuously evaluate the decay function.
- **Streaming job**: A keyed-by-edge-id Flink job recomputes `w(e,t)` on a timer (e.g., every N ms or on read) rather than storing a precomputed static weight, since `w(e,t)` is a function of wall-clock time.
- **Output**: Two downstream sinks — (a) Graph RAM store update, (b) Motif Engine delta-update trigger.

### 2.2 Protocol Decay Registry
- A configuration service (e.g., a small config table backing Flink broadcast state) mapping `protocol → λ_p`.
- Broadcast to all Flink task managers so decay computation is local and doesn't require a network hop per edge.
- Supports hot-reload: updating `λ_p` pushes a new broadcast-state record without job redeploy.

### 2.3 Baseline Deviation Model (FR1.4/1.5)
- Maintains a rolling statistical profile (e.g., exponentially-weighted mean/variance) of aggregated `w(e,t)` per `(entity, protocol)` pair.
- Implemented as a Flink stateful operator (keyed state per entity-protocol) to avoid a separate database round-trip.
- Emits a z-score-like deviation signal alongside each edge update; large deviations become a feature fed into T-GNN inference and/or a standalone anomaly alert.

### 2.4 Active Graph Store (PyTorch Geometric Temporal, customized)
- Base modeling library is **PyTorch Geometric Temporal** (the originating idea's chosen library); this design further customizes it rather than replacing it, since off-the-shelf PyG Temporal assumes a fixed or snapshot-based graph, not a continuously-pruned live one.
- In-memory dynamic graph structure supporting O(1)/O(log n) edge insert and removal.
- Customization: PyG's static `edge_index` tensor model is replaced/wrapped with a mutable adjacency structure (e.g., a `TemporalEdgeStore` backed by a hash map keyed by edge id, plus per-node adjacency lists) that can drop edges mid-stream without rebuilding the full tensor graph each step.
- The forward pass reads the *current* live adjacency structure at inference time — supports "dynamic dropping of edges during the forward pass" as required by the tech stack note.

### 2.5 Pruning Watcher (Threshold-Based Pruning, FR2)
- A background thread/process (co-located with the graph store or a separate Flink job) that:
  1. Periodically scans active edges (or reacts to a decay-crossing timer per edge) and evaluates `w(e,t) < ε`.
  2. On threshold breach: removes edge from Active Graph Store, serializes edge record, and writes to Neo4j (cold storage).
  3. Publishes a "pruned" event onto an internal bus so the Motif Cache can reset any dependent partial motif state (FR3.3).
- `ε` is computed from a memory-pressure feedback loop (e.g., current Graph RAM usage vs. configured ceiling) — as usage approaches the ceiling, `ε` rises (more aggressive pruning); as usage falls, `ε` relaxes.

### 2.6 Motif Cache & Delta-Update Engine (Redis)
- **Motif library**: arbitrary and operator-configurable (specs.md FR3.1/FR3.5) — the cache and delta-update algorithm below are generic over any motif definition, not hardcoded to specific patterns. Two seed motifs are used to bootstrap and calibrate the system: (1) `User → Service Account → Admin Share`, and (2) the originating scenario's canonical timed pattern `Machine A → Machine B (auth)` followed within a bounded window (e.g., ~4 hours) by `Machine B's admin account → Machine C (auth/RCE)`. Additional motifs are added by inserting new motif definitions (§2.6 schema), not by changing the engine.
- **Data structure**: For each motif definition, a Redis hash (or similar) keyed by the candidate entity chain (e.g., `motif:admin_share_escalation:{user_id}` or `motif:lateral_pivot:{machine_b_id}`), storing:
  - `stage`: index of last-matched step in the motif sequence.
  - `last_edge_ts`: timestamp of the most recently matched edge.
  - `matched_edges`: list/set of edge ids that contributed to the current partial match.
- **Delta-update algorithm** (on new edge ingest):
  1. Look up motif definitions whose *next required step* matches this edge's `(src_type, dst_type, protocol)` shape.
  2. For each match, fetch/create the corresponding motif-state record for the entity chain.
  3. Advance `stage`; if `stage == final`, emit a motif-completion alert and clear/archive the state.
  4. If the edge does not match any expected next step for an existing partial state within its time bound, no update occurs (state untouched, subject to normal expiry).
- **Motif reset on prune** (FR3.3): The Pruning Watcher's "pruned" event includes the edge id; the Motif Engine checks whether that edge id is a member of any `matched_edges` set and, if so, resets (deletes) that motif-state record.
- **TTL as safety net**: Each motif-state key also carries a Redis TTL derived from the motif's max time bound, so stale states self-expire even if an explicit prune-triggered reset is missed.

### 2.7 Cold Storage (Neo4j)
- Stores pruned edges as graph nodes/relationships (not just flat rows) to preserve queryability for forensic graph traversal (e.g., "reconstruct all activity around user X in the 72 hours before an alert").
- Indexed by entity id and timestamp for fast forensic lookups.

### 2.8 T-GNN Inference Engine
- Consumes the live Active Graph Store plus the deviation signal (2.3) and motif-completion signals (2.6) as auxiliary features/triggers.
- Motif completion can act as a fast-path trigger that requests an immediate T-GNN inference pass over the relevant local neighborhood, rather than waiting for the next scheduled inference cycle.

### 2.9 Reference Ingestion Adapter & Validation Dataset
- **Production adapter**: A Sysmon/Windows Event Log adapter is the first-class reference ingestion source feeding the Flink layer (2.1). It maps Sysmon event IDs (e.g., logon events, file-share access, process creation/remote-exec events) to the typed edges defined in specs.md FR5.2 (`Authentication`, `File Transfer`, `Remote Code Execution`), each tagged with its underlying protocol for FR1 decay purposes.
- **Offline validation adapter**: A replay adapter ingests the **LANL Comprehensive Cybersecurity dataset** through the same Flink pipeline in "replay mode" (events fed in original chronological order at accelerated speed). This is used to calibrate initial `λ_p` values and validate motif detection (Section 2.6) against known-labeled red-team activity before any production deployment.
- Both adapters emit the same normalized edge schema, so the Active Graph Store, Pruning Watcher, and Motif Engine are adapter-agnostic — new log sources (e.g., cloud IAM logs) can be added as additional adapters without touching the core pipeline.

## 3. Data Flow (Happy Path)

1. Raw log event arrives (e.g., an SMB file-share access).
2. Flink parses it into an edge `(src, dst, protocol=SMB, t_e, w_0)`.
3. Flink computes/refreshes `w(e,t)` using `λ_SMB` from the Protocol Decay Registry.
4. Edge is written into the Active Graph Store; baseline deviation model updates the entity's rolling profile.
5. Edge is passed to the Motif Engine for delta-update against cached partial motifs.
6. In parallel, the Pruning Watcher evaluates existing edges; any edge with `w(e,t) < ε` is evicted to Neo4j and a "pruned" event fires (resetting dependent motif state if applicable).
7. If a motif completes, an alert signal is emitted and may trigger targeted T-GNN inference.
8. T-GNN periodically (or on-trigger) runs inference over the current bounded Active Graph Store, using deviation signals as features, to score anomalies.

## 4. Key Design Decisions & Rationale

| Decision | Rationale |
|---|---|
| Decay computed on-read/continuously in Flink rather than precomputed once at ingest | `w(e,t)` depends on current time `t`, not just `t_e`; must be re-evaluated as time passes. |
| Per-protocol `λ_p` as broadcast state, not per-edge lookup to an external store | Avoids network round-trip per event at enterprise ingest volume; keeps hot path in-memory. |
| Motif state in Redis, not in the graph store itself | Redis provides fast, simple TTL-based expiry and O(1) key access needed for "localized delta-update" without touching the full graph structure. |
| Cold storage in Neo4j rather than flat files/object storage | Preserves graph topology for forensic traversal queries, not just row-level retrieval. |
| Memory-pressure-driven dynamic `ε` | Keeps NFR3 (bounded memory) satisfied under variable load, rather than a static threshold that either under- or over-prunes. |
| Motif reset triggered by prune events | Directly implements the requirement that a motif sequence "broken by time" (i.e., contributing edge pruned) must reset, preventing stale/false motif completions. |

## 5. Failure Modes & Mitigations

| Failure Mode | Mitigation |
|---|---|
| Flink backpressure during log spikes | Backpressure-aware `ε` tightening (prune more aggressively) to keep Active Graph Store bounded; degrade gracefully per NFR4. |
| Redis unavailable | Motif detection degrades to disabled/best-effort; anomaly-based (non-motif) detection via T-GNN continues unaffected. |
| Neo4j write latency spike | Buffer pruned edges in a local queue before cold-storage write; never block the prune-from-RAM step on cold-storage ack. |
| Incorrect `λ_p` causing over/under pruning | Hot-reloadable config (2.2) allows rapid correction without redeploy; audit log (NFR5) surfaces pruning rate anomalies. |

## 6. Open Design Items

- Exact schema for motif definitions (DSL vs. code-defined) — affects FR3.5 extensibility.
- Whether baseline deviation model needs seasonality awareness (e.g., day-of-week / business-hours patterns) to reduce false positives.
- Sizing model for Active Graph Store RAM ceiling vs. expected enterprise node/edge cardinality.
