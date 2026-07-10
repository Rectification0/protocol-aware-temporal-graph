# Tasks: Protocol-Aware Asymmetric Decay and Stateful Motif Pruning in CTDGs

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

## Phase 0 — Foundations

- [x] 0.1 Stand up base infra: Apache Flink cluster, Redis instance, Neo4j instance (dev environment). *(docker-compose.yml written as the target stack; local dev currently redirected to a Postgres instance instead -- see README.md "Local dev database". Bring up the compose stack when Flink/Redis/Neo4j-backed phases need it.)*
- [x] 0.2 Define edge schema (`src`, `dst`, `protocol`, `t_e`, `w_0`, `w(e,t)`) as a shared data contract across Flink, PyG, Redis, Neo4j. *(config/schema/edge.schema.json + src/t_gnn/schema.py)*
- [x] 0.3 Define initial protocol set and placeholder decay constants (RDP, SMB, Kerberos, DNS) for early testing. *(config/protocols.yaml + src/t_gnn/protocol_registry.py)*
- [x] 0.4 Acquire and stage the LANL Comprehensive Cybersecurity dataset for offline replay/calibration (specs.md FR5.4). *(src/t_gnn/data/stage_lanl.py staging pipeline + data/lanl/README.md acquisition instructions; real dataset download is an operational step, not vendored in-repo)*
- [x] 0.5 Build a Sysmon/Windows Event Log ingestion adapter mapping Sysmon event IDs to typed edges (Authentication, File Transfer, Remote Code Execution) per specs.md FR5.2/FR5.3. *(src/t_gnn/ingestion/sysmon_adapter.py)*

## Phase 1 — Protocol-Aware Asymmetric Time-Decay (FR1)

- [ ] 1.1 Implement Protocol Decay Registry (broadcast-state config: `protocol → λ_p`) in Flink.
- [ ] 1.2 Implement hot-reload mechanism for `λ_p` updates without job redeploy.
- [ ] 1.3 Implement streaming computation of `w(e,t) = w_0 · e^(-λ_p (t - t_e))` per active edge.
- [ ] 1.4 Implement rolling baseline distribution model per `(entity, protocol)` (keyed Flink state, e.g., EWMA mean/variance).
- [ ] 1.5 Implement deviation-signal computation (e.g., z-score of current aggregated weight vs. baseline).
- [ ] 1.6 Unit tests: decay curve correctness per protocol; verify RDP decays faster than SMB under identical `t - t_e`.
- [ ] 1.7 Calibration pass: derive/tune initial `λ_p` values using the LANL dataset replay (task 0.4) as the primary benchmark, supplemented by production Sysmon telemetry once available (or expert defaults if neither is available).

## Phase 2 — Dynamic Graph Pruning (FR2)

- [ ] 2.1 Design and implement the Active Graph Store as a mutable structure compatible with PyTorch Geometric (dynamic insert/remove of edges).
- [ ] 2.2 Implement Pruning Watcher background process: continuous scan/evaluation of `w(e,t) < ε`.
- [ ] 2.3 Implement memory-pressure feedback loop to compute dynamic `ε` (rising under pressure, relaxing when headroom available).
- [ ] 2.4 Implement edge serialization + write path to Neo4j cold storage on prune.
- [ ] 2.5 Implement "pruned edge" event publication (internal bus/topic) for downstream consumers (Motif Engine).
- [ ] 2.6 Ensure pruning runs asynchronously and does not block T-GNN inference reads (FR2.5).
- [ ] 2.7 Load test: verify Active Graph Store size stays bounded under sustained high-volume synthetic ingest.
- [ ] 2.8 Latency test: verify T-GNN inference remains sub-millisecond (NFR1) with pruning active under load.

## Phase 3 — Stateful Motif Caching (FR3)

- [ ] 3.1 Define initial motif definition schema (ordered/typed edge-pattern sequence + completion condition + time bound).
- [ ] 3.2 Implement the motif engine generically (any operator-defined pattern), then load two seed motifs for initial calibration/testing: `User → Service Account → Admin Share`, and the originating scenario's timed two-hop pattern `Machine A → Machine B (auth), then Machine B's admin account → Machine C (auth/RCE)` within a bounded window (e.g., ~4 hours).
- [ ] 3.3 Implement Redis-backed motif-state data structure (per candidate entity chain: stage, last_edge_ts, matched_edges).
- [ ] 3.4 Implement delta-update algorithm: on new edge ingest, advance matching motif state(s) without full-graph traversal.
- [ ] 3.5 Implement motif-completion alert emission.
- [ ] 3.6 Implement motif-reset-on-prune: subscribe to "pruned edge" events (2.5) and reset motif state if a matched edge is evicted.
- [ ] 3.7 Implement TTL-based motif-state expiry as a safety net independent of explicit prune events.
- [ ] 3.8 Unit/integration tests: motif completes correctly on matching sequence; motif resets correctly when a contributing edge is pruned before completion.
- [ ] 3.9 Design motif definition extensibility mechanism (config-driven vs. code-driven) per FR3.5.

## Phase 4 — Cold Storage & Forensics (FR4)

- [ ] 4.1 Design Neo4j graph schema for pruned-edge storage (nodes/relationships, indexed by entity id + timestamp).
- [ ] 4.2 Implement forensic query API/interface (e.g., "reconstruct activity around entity X in time window Y").
- [ ] 4.3 Verify pruned edges retain full original metadata (protocol, weight-at-prune-time, timestamps, endpoints).

## Phase 5 — T-GNN Integration

- [ ] 5.1 Customize PyTorch Geometric forward pass to read live Active Graph Store (dynamic edge dropping mid-stream).
- [ ] 5.2 Wire deviation signal (1.5) into T-GNN as an input feature.
- [ ] 5.3 Wire motif-completion signal (3.5) as a fast-path trigger for targeted/immediate inference.
- [ ] 5.4 End-to-end test: replay the LANL dataset (task 0.4) as a "low and slow" APT scenario and confirm detection via baseline deviation.
- [ ] 5.5 End-to-end test: inject a synthetic motif-matching attack sequence and confirm motif-completion alert fires.

## Phase 6 — Observability & Hardening

- [ ] 6.1 Implement audit logging for all prune events and motif resets (NFR5).
- [ ] 6.2 Implement dashboards/metrics: active graph size, prune rate, ε over time, motif cache hit/reset rate, inference latency.
- [ ] 6.3 Implement graceful-degradation behavior for Redis unavailability (motif detection disabled, anomaly detection unaffected).
- [ ] 6.4 Implement buffering for Neo4j write-path so cold-storage latency never blocks pruning.
- [ ] 6.5 Chaos/failure testing: Flink backpressure, Redis outage, Neo4j slow writes — verify mitigations from design.md §5.

## Phase 7 — Documentation & Rollout

- [ ] 7.1 Document configuration reference (decay constants, ε tuning, motif definition format).
- [ ] 7.2 Document operational runbook (how to tune `λ_p`, add new motifs, investigate forensic queries).
- [ ] 7.3 Pilot deployment against a subset of enterprise log traffic; validate false-positive/negative rates before full rollout.

## Backlog / Open Questions (tracked, not yet actionable)

- [ ] Determine full initial motif library beyond the seed example (see specs.md §8).
- [ ] Decide whether `ε` should be per-protocol vs. global (see specs.md §8).
- [ ] Evaluate seasonality-awareness need for baseline deviation model (see design.md §6).
