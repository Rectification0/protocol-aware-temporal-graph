# Tasks: Protocol-Aware Asymmetric Decay and Stateful Motif Pruning in CTDGs

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

## Phase 0 — Foundations

- [x] 0.1 Stand up base infra: Apache Flink cluster, Redis instance, Neo4j instance (dev environment). *(docker-compose.yml written as the target stack; local dev currently redirected to a Postgres instance instead -- see README.md "Local dev database". Bring up the compose stack when Flink/Redis/Neo4j-backed phases need it.)*
- [x] 0.2 Define edge schema (`src`, `dst`, `protocol`, `t_e`, `w_0`, `w(e,t)`) as a shared data contract across Flink, PyG, Redis, Neo4j. *(config/schema/edge.schema.json + src/t_gnn/schema.py)*
- [x] 0.3 Define initial protocol set and placeholder decay constants (RDP, SMB, Kerberos, DNS) for early testing. *(config/protocols.yaml + src/t_gnn/protocol_registry.py)*
- [x] 0.4 Acquire and stage the LANL Comprehensive Cybersecurity dataset for offline replay/calibration (specs.md FR5.4). *(src/t_gnn/data/stage_lanl.py staging pipeline + data/lanl/README.md acquisition instructions; real dataset download is an operational step, not vendored in-repo)*
- [x] 0.5 Build a Sysmon/Windows Event Log ingestion adapter mapping Sysmon event IDs to typed edges (Authentication, File Transfer, Remote Code Execution) per specs.md FR5.2/FR5.3. *(src/t_gnn/ingestion/sysmon_adapter.py)*

## Phase 1 — Protocol-Aware Asymmetric Time-Decay (FR1)

- [x] 1.1 Implement Protocol Decay Registry (broadcast-state config: `protocol → λ_p`) in Flink. *(src/t_gnn/protocol_registry.py `ProtocolDecayRegistry` -- staged as a framework-agnostic loader per CLAUDE.md's Postgres-redirect philosophy; becomes the payload of real Flink broadcast state once a phase needs that cluster's live semantics.)*
- [x] 1.2 Implement hot-reload mechanism for `λ_p` updates without job redeploy. *(`ProtocolDecayRegistry.reload()`, already present from Phase 0 -- re-reads config/protocols.yaml from disk without restarting the process.)*
- [x] 1.3 Implement streaming computation of `w(e,t) = w_0 · e^(-λ_p (t - t_e))` per active edge. *(src/t_gnn/decay.py `compute_weight()` + `DecayEngine`.)*
- [x] 1.4 Implement rolling baseline distribution model per `(entity, protocol)` (keyed Flink state, e.g., EWMA mean/variance). *(src/t_gnn/baseline.py `EWMABaseline` + `BaselineStore`, keyed in-memory dict standing in for Flink keyed state; entity = edge.src.)*
- [x] 1.5 Implement deviation-signal computation (e.g., z-score of current aggregated weight vs. baseline). *(src/t_gnn/baseline.py `BaselineStore.observe()` returns a `DeviationSignal` with a z-score computed against the pre-update baseline; src/t_gnn/streaming.py `DecayStreamProcessor` wires decay + baseline into one per-edge step.)*
- [x] 1.6 Unit tests: decay curve correctness per protocol; verify RDP decays faster than SMB under identical `t - t_e`. *(tests/test_decay.py, tests/test_baseline.py, tests/test_streaming.py.)*
- [x] 1.7 Calibration pass: derive/tune initial `λ_p` values using the LANL dataset replay (task 0.4) as the primary benchmark, supplemented by production Sysmon telemetry once available (or expert defaults if neither is available). *(src/t_gnn/data/calibrate_decay.py -- derives suggested λ_p per protocol from median same-entity inter-arrival gaps in staged LANL edges, reporting `sufficient_data`/falling back to the current expert default when a protocol has too few samples; only the tiny synthetic fixture is vendored, so real calibration awaits the full LANL dataset per task 0.4.)*

## Phase 2 — Dynamic Graph Pruning (FR2)

- [x] 2.1 Design and implement the Active Graph Store as a mutable structure compatible with PyTorch Geometric (dynamic insert/remove of edges). *(src/t_gnn/graph_store.py `ActiveGraphStore` -- hash-map-keyed edge store + per-node adjacency sets per design.md's `TemporalEdgeStore`; `to_pyg_edge_index()` materializes a live torch.LongTensor edge_index on demand.)*
- [x] 2.2 Implement Pruning Watcher background process: continuous scan/evaluation of `w(e,t) < ε`. *(src/t_gnn/pruning.py `PruningWatcher.run_once()`/`start()`/`stop()` -- daemon-thread loop calling `run_once()` on `poll_interval`.)*
- [x] 2.3 Implement memory-pressure feedback loop to compute dynamic `ε` (rising under pressure, relaxing when headroom available). *(src/t_gnn/pruning.py `EpsilonController` -- interpolates between `epsilon_min`/`epsilon_max` using the max of real system-memory pressure (`psutil`, via `default_memory_probe()`) and graph-size pressure vs. a configurable `max_edges` ceiling.)*
- [x] 2.4 Implement edge serialization + write path to Neo4j cold storage on prune. *(src/t_gnn/cold_storage.py `Neo4jColdStorageWriter` -- writes `(Entity)-[:PRUNED_EDGE]->(Entity)` via the real `neo4j` driver against the now-running docker-compose Neo4j instance; write happens before removal from the Active Graph Store per FR2.4, with a failed write leaving the edge active for retry rather than dropping it. Buffering so a slow write never blocks pruning is deliberately deferred to task 6.4.)*
- [x] 2.5 Implement "pruned edge" event publication (internal bus/topic) for downstream consumers (Motif Engine). *(src/t_gnn/pruning.py `PruneEventBus`/`PrunedEdgeEvent` -- in-process pub/sub; Phase 3's Motif Engine is the first real subscriber and doesn't exist yet, so no Redis/Kafka-backed bus is justified for this hop today.)*
- [x] 2.6 Ensure pruning runs asynchronously and does not block T-GNN inference reads (FR2.5). *(`PruningWatcher` runs on its own daemon thread; `ActiveGraphStore`'s lock is held only for the brief dict/set mutation inside `remove()`, never across the cold-storage write's network I/O, so reads are never blocked on slow writes.)*
- [x] 2.7 Load test: verify Active Graph Store size stays bounded under sustained high-volume synthetic ingest. *(tests/test_load.py `test_active_graph_store_stays_bounded_under_sustained_ingest` -- proxy-scale smoke test, not literal enterprise volume.)*
- [x] 2.8 Latency test: verify T-GNN inference remains sub-millisecond (NFR1) with pruning active under load. *(tests/test_load.py `test_reads_stay_fast_while_pruning_runs_concurrently` -- `store.get()` stands in for a T-GNN inference read since no real inference engine exists yet (Phase 5); proxy latency check, not a production benchmark.)*

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
