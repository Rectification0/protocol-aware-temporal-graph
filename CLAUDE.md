# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Protocol-Aware Asymmetric Decay and Stateful Motif Pruning in CTDGs: a real-time
threat-detection system design for enterprise networks, built on Temporal GNNs
over Continuous-Time Dynamic Graphs. The four planning docs at the repo root are
the source of truth and should be read before implementing any new phase:

- `functionality.txt` — narrative blueprint of the three core mechanisms (decay, pruning, motif caching).
- `specs.md` — functional/non-functional requirements (FR1–FR5, NFR1–NFR5).
- `design.md` — architecture, component responsibilities, failure modes.
- `tasks.md` — phased implementation plan with checkbox status; **check this first** to see what's already implemented before starting new work, and flip checkboxes as tasks complete.

Phase 0 (Foundations), Phase 1 (Protocol-Aware Asymmetric Time-Decay),
Phase 2 (Dynamic Graph Pruning), Phase 3 (Stateful Motif Caching), Phase 4
(Cold Storage & Forensics), Phase 5 (T-GNN Integration), and Phase 6
(Observability & Hardening) are implemented so far. Phase 1 is
pure-Python/staging (see the Architecture section for what each module
stands in for and why). Phase 2 is a mix: the Active Graph Store and
Pruning Watcher are framework-agnostic Python (no live Flink job), but its
Neo4j cold-storage write path is real — it runs against the actual
`docker-compose.yml` Neo4j instance via the `neo4j` driver, not a
placeholder. Phase 3 is the same kind of mix: the motif definition
schema/registry and the engine's delta-update/reset logic are
framework-agnostic Python (no live Flink edge-ingest job driving
`MotifEngine.on_edge()` yet), but its Redis-backed motif-state store is
real — `RedisMotifStateStore` runs against the actual `docker-compose.yml`
Redis instance via the `redis` driver, with the reset-on-prune wiring
(`MotifEngine.on_prune`) connected live to Phase 2's `PruneEventBus`. Phase
4 is entirely real, no staging split — it's a read-only query layer over
the same live Neo4j data Phase 2 already writes, so there's no framework
(Flink/PyG) dependency to stand in for in the first place. Phase 5 uses a
genuinely real PyTorch Geometric forward pass over the live `ActiveGraphStore`
— nothing about the graph-sourcing/feature-wiring/trigger integration is
staged — but per specs.md §4's explicit non-goal, the model architecture
itself is a deliberately small, untrained reference network, not a
production-trained T-GNN; see the Architecture section. Phase 6 is
framework-agnostic in the same sense Phase 1's decay/baseline logic is —
`MetricsCollector`/`AuditLogger` are the in-process aggregators a real
dashboard/log-shipping pipeline would read from, since no such pipeline is
provisioned in docker-compose.yml — but its hardening changes to
`MotifEngine` (6.3) and its `BufferedColdStorageWriter` (6.4) are real,
load-bearing code paths, not staged.
`docker-compose.yml`'s Flink/Redis/Neo4j stack is running locally (brought
up ahead of schedule, before Phase 2 started, at the developer's request)
— see "Local dev database" below. Later phases (documentation/rollout) do
not have code yet.

## End-of-phase checklist

When every checkbox in a `tasks.md` phase is flipped to done, before moving on:

1. **Update this file.** Revise the "only Phase N is implemented" line above,
   extend the Architecture section with whatever new load-bearing
   abstractions/conventions that phase introduced, and add any new commands.
   Keep it a living doc, not a Phase-0 snapshot.
2. **Update `README.md` and any other non-planning docs** that describe
   current implementation status, layout, or setup/dev-environment
   instructions (e.g. a `docs/` folder, if one shows up later). These drift
   stale independently of this file — updating CLAUDE.md does not cover
   them. This explicitly excludes `functionality.txt`, `specs.md`,
   `design.md`, and `tasks.md`: the first three are the fixed
   planning/source-of-truth docs (requirements/architecture as designed,
   not implementation snapshots to rewrite as phases land), and `tasks.md`
   already has its own status-tracking mechanism (flip its checkboxes as
   tasks complete, per the Project section above) rather than needing prose
   updates here.
3. **Re-check `.gitignore`.** Scan for anything the phase's work generates
   that isn't already covered — new build/cache artifacts (e.g. a new
   toolchain's equivalent of `*.egg-info/`), new local data/output
   directories, new env/credential files — and add entries before committing.
4. **Include all of the above in the phase's commit(s).** These doc/config
   updates land in the same commit(s) as the phase's code, not a follow-up
   commit — so `git log` never shows a phase "done" with its docs still
   pointing at the previous phase's state.

## Commands

```bash
pip install -e ".[dev]"                 # install package + pytest
pytest                                   # run full test suite
pytest tests/test_schema.py              # run one test file
pytest tests/test_schema.py::test_round_trip_json   # run one test
python scripts/init_postgres.py          # idempotent: create the t_gnn_dev database
python -m t_gnn.data.stage_lanl --input <auth.txt.gz> --output <dir>   # stage LANL dataset
python -m t_gnn.data.calibrate_decay --staged-dir <dir> [--output report.json]   # suggest lambda_p per protocol from staged edges
docker compose up -d                     # bring up Flink/Redis/Neo4j (needed for the Neo4j and Redis integration tests)
```

There is no lint/format/build step configured yet.

## Local dev database — read before adding any persistence code

`docker-compose.yml`'s Flink/Redis/Neo4j stack (`docker compose up -d`) is
now running for local dev: Flink UI on `localhost:8081`, Neo4j on
`localhost:7474`/`7687`, Redis on `localhost:6379` — verified reachable.
It was brought up ahead of its originally-planned trigger point (Phase 3's
Redis TTL semantics / Phase 4's Neo4j) at the developer's explicit request,
so it's available from the start of Phase 2. New persistence work that maps
to one of these systems' actual role in `design.md` — cold-storage edge
writes to Neo4j (2.4), motif state in Redis (3.3) — should target that
system directly now, not Postgres.

Separately, a Postgres instance the developer runs locally (`localhost:5432`,
database `t_gnn_dev`) is still reachable via `src/t_gnn/db.py`
(`get_connection()`). It was the temporary redirect for persistence work
before this stack existed; nothing has ever actually been written through it
(`scripts/init_postgres.py` only creates the empty database — no tables
exist yet), so nothing needs migrating. Keep using it only for persistence
needs that *don't* map to Flink/Redis/Neo4j's roles in `design.md`; create
tables only when a task actually needs them.

Tests that need the live Neo4j instance (`tests/test_cold_storage.py`'s
`Neo4jColdStorageWriter` tests, `tests/test_forensics.py`'s
`Neo4jForensicQueryAPI` tests) or the live Redis instance
(`tests/test_motif_engine.py`'s `RedisMotifStateStore` tests) check
connectivity at collection time and `skip` (not fail) if
`docker compose up -d` hasn't been run — the rest of the suite doesn't
depend on the stack being up.

Connection settings load from `.env` (auto-loaded by `t_gnn/db.py`, gitignored,
holds real credentials) with `.env.example` as the committed placeholder
template — never put real credentials in `.env.example` or any tracked file.

## Architecture

**The shared edge contract is the load-bearing abstraction.** Every
component described in `design.md` (Flink ingestion, the PyG Active Graph
Store, the Redis motif cache, Neo4j cold storage) is meant to operate on the
same edge shape. That contract has two synchronized representations that
must be kept in lockstep when changed:

- `config/schema/edge.schema.json` — the language-agnostic JSON Schema definition (authoritative for the field set/types/enums).
- `src/t_gnn/schema.py` (`Edge` dataclass) — the Python implementation, with `.validate()` checking an instance against the JSON Schema, `to_json`/`from_json` for round-tripping, and `make_edge_id()` for the deterministic id used as the Redis/Neo4j/graph-store key.

Node ids are strings of the form `"<Type>:<name>"` (e.g. `"User:alice"`,
`"Machine:C1042"`); `Edge.__post_init__` infers `src_type`/`dst_type` from
that prefix. Edge type is one of `Authentication` / `FileTransfer` /
`RemoteCodeExecution` (specs.md FR5.2); protocol is one of `RDP` / `SMB` /
`Kerberos` / `DNS` (specs.md FR1.2) and selects the decay constant.

**Protocol decay constants** live in `config/protocols.yaml` and are loaded
through `src/t_gnn/protocol_registry.py` (`ProtocolDecayRegistry`). This is
explicitly a placeholder/staging-era loader — `design.md` §2.2 calls for
these values to eventually live in Flink broadcast state for true hot-reload
without redeploy (tasks.md 1.1/1.2); don't conflate the two until that phase
is implemented.

**Phase 1's decay/baseline/deviation logic is framework-agnostic Python,
staged the same way** — each module below is the business logic a real
Flink job's operators will call once one exists; none of it depends on a
running Flink cluster today:

- `src/t_gnn/decay.py` (`compute_weight()`, `DecayEngine`) — FR1.1/1.3: `w(e,t) = w_0 · e^(-λ_p·(t-t_e))`, with elapsed time clamped to zero rather than letting `t < t_e` amplify weight above `w_0`. `DecayEngine.refresh(edge, t)` returns a *new* `Edge` (via `dataclasses.replace`) with `w`/`w_evaluated_at` set — it never mutates the input edge.
- `src/t_gnn/baseline.py` (`EWMABaseline`, `BaselineStore`, `DeviationSignal`) — FR1.4/1.5: an exponentially-weighted mean/variance profile keyed by `(entity, protocol)`, where `entity` is taken as `edge.src` (the acting principal, per `functionality.txt`'s "aggregated edge weights for a specific user"). `BaselineStore` is an in-memory dict standing in for Flink keyed state (design.md §2.3). `z_score` is computed against the baseline *before* the new observation is folded in (so an outlier is scored against unpolluted history), and is `None` until at least 2 prior samples with nonzero variance exist — avoids a misleading always-zero/divide-by-zero score early in a key's life.
- `src/t_gnn/streaming.py` (`DecayStreamProcessor`) — ties `DecayEngine` + `BaselineStore` into the single per-edge step described in design.md §3 ("Data Flow") steps 2–4: refresh `w(e,t)`, then feed it to the entity/protocol baseline to get a `DeviationSignal`. This is the shape a Flink `ProcessFunction` will wrap per edge.
- `src/t_gnn/data/calibrate_decay.py` (`calibrate()`) — tasks.md 1.7: derives a suggested `λ_p` per protocol from the median same-entity consecutive-edge time gap in staged LANL edges (`stage_lanl.py` output), but only *reports* a suggestion when a protocol clears `min_samples`; below that it flags `sufficient_data=False` and defers to the protocol's current registry value, per tasks.md 1.7's explicit "expert defaults if neither [dataset nor telemetry] is available" allowance. Only the tiny synthetic fixture is vendored — running this against it is a smoke test of the mechanism, not a real calibration.

**Phase 2's dynamic graph pruning is a mix of framework-agnostic Python and
one real infra integration** — the Active Graph Store and Pruning Watcher
don't depend on a live Flink job, but the cold-storage write path is genuine
(Neo4j is up):

- `src/t_gnn/graph_store.py` (`ActiveGraphStore`) — FR2/NFR3: a hash map of `edge_id -> Edge` plus per-node outgoing/incoming adjacency sets (design.md 2.4's `TemporalEdgeStore`), guarded by a single `RLock` held only for the duration of each dict/set mutation. `to_pyg_edge_index()` materializes the *current* live state fresh on every call into a `torch.LongTensor` edge_index (shape `[2, E]`) plus the column-aligned edge id list and node-id-to-index map — Phase 5's customized T-GNN forward pass is the intended caller; Phase 2 itself does no message-passing.
- `src/t_gnn/pruning.py` (`EpsilonController`, `PruneEventBus`/`PrunedEdgeEvent`, `PruningWatcher`) — FR2.2/2.3/2.5: `EpsilonController.compute_epsilon()` takes the *max* of real system-memory pressure (via `psutil`, `default_memory_probe()`) and graph-size pressure vs. a configurable `max_edges` ceiling, then interpolates between `epsilon_min`/`epsilon_max` — memory-aware per FR2.3 while still guaranteeing NFR3's size ceiling even if per-edge memory footprint isn't constant. `PruningWatcher.run_once(t)` is the synchronous, testable scan-and-prune pass; `start()`/`stop()` wrap it in a daemon background thread (FR2.1/2.5). Per FR2.4's "before removal" ordering, a candidate edge is written to cold storage *first* — only removed from the store on write success, left active for retry on failure (a full buffered/async write path is deliberately deferred to tasks.md 6.4, per that task split). `PruneEventBus` is a plain in-process pub/sub standing in for whatever bus a production deployment wires this to; Phase 3's `MotifEngine.on_prune()` (motif_engine.py) was its first real subscriber, and Phase 6 added two more (`audit.py`'s `AuditLogger.log_prune`, `metrics.py`'s `MetricsCollector`) -- still no Redis/Kafka-backed bus justified, since in-process pub/sub keeps serving every subscriber added so far just fine.
- `src/t_gnn/cold_storage.py` (`ColdStorageWriter` protocol, `Neo4jColdStorageWriter`, `InMemoryColdStorageWriter`, `BufferedColdStorageWriter`) — FR2.4/FR4.2: writes each pruned edge as `(Entity {id})-[:PRUNED_EDGE {...}]->(Entity {id})` via the real `neo4j` Bolt driver against `docker-compose.yml`'s Neo4j instance (connection config from `.env`'s `NEO4J_*` vars, defaulting to the compose stack's dev credentials), creating `Entity.id` and `PRUNED_EDGE.pruned_at` indexes on first use. This is genuinely wired up, not staged — Phase 4's `forensics.py` builds the forensic query API on top of this same relationship shape. `InMemoryColdStorageWriter` is a recording fake used in `PruningWatcher` unit tests that don't need live Neo4j. `BufferedColdStorageWriter` (tasks.md 6.4) is a drop-in `ColdStorageWriter` wrapper added in Phase 6 -- see the Phase 6 Architecture section below.

**Two ingestion adapters both produce `Edge` instances**, and are meant to be
interchangeable inputs to the same downstream pipeline (design.md §2.9):

- `src/t_gnn/ingestion/sysmon_adapter.py` (`SysmonEventAdapter.parse()`) — takes a normalized Windows Security/Sysmon event dict (flat, already parsed from XML by whatever log shipper) and dispatches on `(Channel, EventID)` to a handler. Deliberately combines two event families to reconstruct the two hops of the canonical lateral-movement motif from specs.md §1.1: Sysmon EventID 3 (NetworkConnect) yields the `Machine -> Machine` first hop, while Security logon events and Sysmon EventID 1 (ProcessCreate) yield the `User -> Machine` second hop. Protocol inference per event type is a documented heuristic (port number for NetworkConnect, LogonType/AuthenticationPackageName for logons, parent-process name for RCE) expected to be refined once real telemetry/calibration data is available.
- `src/t_gnn/data/stage_lanl.py` (`stage()`) — converts the LANL Comprehensive Cybersecurity dataset's `auth.txt.gz` (relative-time CSV, documented in `data/lanl/README.md`) into sharded NDJSON of the same `Edge` shape, anchoring the dataset's relative timestamps to a real epoch via `--epoch-start`. The real multi-GB dataset isn't vendored; `data/lanl/raw/sample_auth.txt.gz` is a tiny synthetic fixture in the same column format for tests.

When adding a third ingestion source, follow this same pattern: parse into
`Edge` instances via `schema.py`, don't invent a parallel edge representation.

**Phase 3's motif definitions follow the same schema/Python-representation
split as the edge contract**, and its engine is a mix of framework-agnostic
Python and one real infra integration, the same shape Phase 2 took with
Neo4j:

- `config/schema/motif.schema.json` + `src/t_gnn/motifs.py` (`MotifStep`, `MotifDefinition`, `MotifRegistry`) — FR3.1/3.5/tasks.md 3.1/3.9: a motif is an ordered sequence of `MotifStep`s (structural filters on `edge_type`/`protocol`/`src_type`/`dst_type`) plus a `window_seconds` completion bound. Each step's `key_field`/`key_resolver` describe how it chains to the entity bound by the previous step — `key_resolver` is the config-vs-code extensibility seam (tasks.md 3.9): `"identity"` (the endpoint id must literally equal the chain key) is enough for motifs like `admin_share_escalation` where the same entity reappears across hops; `"host_admin"` is a documented naming-convention *heuristic* (same spirit as `sysmon_adapter.py`'s protocol inference) standing in for real directory/asset-inventory linkage between a Machine and the User account(s) that administer it, needed for the `lateral_pivot` seed motif's "Machine B's admin account" hop. New motifs expressible with existing resolvers are pure config (`config/motifs.yaml` + `MotifRegistry.reload()`); motifs needing new entity-linkage semantics require a new `KeyResolver` registered in `KEY_RESOLVERS`.
- `src/t_gnn/motif_engine.py` (`MotifEngine`, `MotifState`, `MotifStateStore` protocol, `RedisMotifStateStore`, `InMemoryMotifStateStore`, `MotifCompletionEvent`/`MotifAlertBus`, `MotifResetEvent`/`MotifResetBus`) — FR3.2/3.3/3.4/3.5: `MotifEngine.on_edge()` is the delta-update (design.md 2.6) — for every definition, it computes each step's candidate chain key directly from the incoming edge's endpoint (via that step's resolver), so advancing a partial match is a direct key lookup against `RedisMotifStateStore`, never a scan of existing states. `RedisMotifStateStore` is genuinely wired up against `docker-compose.yml`'s Redis (like `Neo4jColdStorageWriter` was for 2.4) — a hash per `(motif_name, chain_key)` plus a reverse-index set per edge id — with `EXPIRE` set to the motif's `window_seconds` on every write (tasks.md 3.7's TTL safety net). `InMemoryMotifStateStore` is the unit-test fake, tracking the same TTL semantics against an injectable clock instead of wall-clock sleeps. Reaching a definition's final stage emits a `MotifCompletionEvent` via `MotifAlertBus` (FR3.4) and clears the state.
- Motif-reset-on-prune (FR3.3/tasks.md 3.6) is `MotifEngine.on_prune()`, auto-subscribed to a `pruning.py` `PruneEventBus` when one is passed to `MotifEngine`'s constructor — it uses the state store's reverse edge-id index to find and delete any partial match that depended on the just-pruned edge, live-wired to Phase 2's existing prune event publication (2.5), not a stub. Each reset also publishes a `MotifResetEvent` on `MotifResetBus` (added in Phase 6, tasks.md 6.1/6.2) -- introduced once there were two real subscribers (the audit logger and the metrics collector) needing to observe resets, not speculatively.
- Graceful degradation on Redis outage (tasks.md 6.3, NFR4, design.md §5) — every `state_store` call inside `MotifEngine` goes through `_state_get`/`_state_set`/`_state_delete`/`_state_containing_edge`, which catch `redis.exceptions.RedisError` instead of propagating it. On failure, `self.available` flips to `False` (logged once, not per edge) and the call site treats it as "no match," so `on_edge()`/`on_prune()` simply stop finding/creating state until Redis returns, at which point the next successful call flips `self.available` back and detection silently resumes. `BaselineStore`/`DecayEngine`/`TGNNInferenceEngine` have zero Redis dependency already, so FR1.5 anomaly detection is unaffected by construction.

**Phase 4 is a read-only query layer over the schema Phase 2 already wrote**,
not a second cold-storage implementation:

- `src/t_gnn/forensics.py` (`Neo4jForensicQueryAPI`, `PrunedEdgeRecord`) — FR4.1/4.2/4.3: reads the exact `(Entity)-[:PRUNED_EDGE]->(Entity)` relationship shape `cold_storage.py`'s `Neo4jColdStorageWriter` writes; there is deliberately no second schema. `reconstruct_activity(entity_id, start, end)` implements design.md 2.7's example query verbatim — matches `entity_id` as either endpoint and filters/orders by `PRUNED_EDGE.t_e` (the *original event* time), which is a different index than the `pruned_at` (eviction time) one 2.4 already created for its own audit use case — both are real indexes, not redundant. `get_edge(edge_id)` is the point-lookup complement, e.g. for resolving a `MotifCompletionEvent.matched_edges` id (motif_engine.py) back to full metadata. Every field FR4.2 requires round-trips through `PrunedEdgeRecord`; there's no `InMemory*` fake here since nothing else in the codebase consumes this API programmatically yet (it's an investigator-facing leaf, not a dependency other unit tests need to swap out).

**Phase 5 wires the earlier phases' live state and signals into an actual
PyTorch Geometric forward pass**, not a placeholder — but per specs.md §4's
explicit non-goal ("replacing the T-GNN model architecture itself"), the
*model* is deliberately minimal; only the integration seams are meant to
be production-shaped:

- `src/t_gnn/tgnn.py` (`DynamicTGNN`, `EntityFeatureTable`, `TGNNInferenceEngine`, `InferenceResult`/`InferenceResultBus`) — 5.1/5.2/5.3, design.md 2.4/2.8: `DynamicTGNN.score_entities()` is the customized forward pass (5.1) — it calls `ActiveGraphStore.to_pyg_edge_index()` (2.1) fresh on every invocation rather than caching it, so an edge pruned since the last call is simply absent from the next pass ("dynamic dropping of edges during the forward pass," verbatim from the tech-stack note). `EntityFeatureTable` is the missing piece `to_pyg_edge_index()` alone doesn't provide: a *stable* node_id -> embedding-row registry, since that method's own `node_index` is recomputed fresh (and non-stable) on every call. `TGNNInferenceEngine.observe_deviation()` caches each entity's latest FR1.5 z-score, concatenated onto its embedding as an extra feature column before every forward pass (5.2) — a real input, not a side-channel annotation (see `test_deviation_feature_changes_the_score` in tests/test_tgnn.py). `TGNNInferenceEngine.on_motif_completion()` auto-subscribes to a `MotifAlertBus` (3.5) and scores only the completed motif's `chain_key` plus its live neighbors immediately (5.3's fast path), rather than waiting for the next scheduled `run_once()` — `run_once()`/`start()`/`stop()` follow the same synchronous-pass-plus-daemon-thread shape as `PruningWatcher` (2.2). The two-`SAGEConv`-layer model itself is untrained/randomly initialized on purpose — swapping in a production-trained architecture later replaces this class, not the engine wired around it.
- The two Phase 5 end-to-end tests (tasks.md 5.4/5.5, in tests/test_tgnn_e2e.py) exercise this wiring against the earlier phases for real: 5.4 stages the sample LANL fixture (0.4) through `DecayStreamProcessor` as background traffic, layers a synthetic "low and slow" tail onto one entity, and confirms FR1.5's z-score flags the tail's anomalous edge; 5.5 replays the canonical two-hop lateral-pivot sequence through a real `MotifEngine` and confirms its completion alert drives `TGNNInferenceEngine`'s fast path with no wiring beyond construction.

**Phase 6 hardens the pipeline rather than adding a new stage** — its two
observability modules are framework-agnostic aggregators (no
Prometheus/Grafana/log-shipping pipeline exists to wire them into yet), but
its two resilience changes are load-bearing code paths already exercised
by the rest of the suite:

- `src/t_gnn/audit.py` (`AuditLogger`, `AuditSink` protocol, `FileAuditSink`, `InMemoryAuditSink`) — tasks.md 6.1, NFR5: subscribes to `pruning.py`'s `PruneEventBus` and `motif_engine.py`'s `MotifResetBus` and writes one newline-delimited JSON record per event via `log_prune()`/`log_motif_reset()`. `FileAuditSink` opens/closes the file per write (durability over throughput — audit records are low-frequency, the opposite tradeoff `BufferedColdStorageWriter` below makes for its much higher-volume path); `InMemoryAuditSink` is the unit-test fake.
- `src/t_gnn/metrics.py` (`MetricsCollector`, `RollingRateCounter`, `EpsilonReading`, `InferenceLatencyReading`, `MetricsSnapshot`) — tasks.md 6.2: active graph size is read live from `ActiveGraphStore.__len__` (not tracked as a series); prune rate / motif hit rate / motif reset rate are `RollingRateCounter`s fed by subscribing to `PruneEventBus` / `MotifAlertBus` / `MotifResetBus` respectively — "hit" is defined as a `MotifCompletionEvent` (a full match, i.e. a detection) rather than every intermediate-stage advance, the more externally meaningful of the two readings design.md's own "cache hit" language could map to. Epsilon-history and inference-latency series come from `observe_pruning_pass()`/`observe_inference_pass()`, which the caller invokes explicitly alongside `PruningWatcher.run_once()`/`TGNNInferenceEngine` passes — no hook was added to either of those classes, since both already return everything `MetricsCollector` needs. `snapshot()` is the single dashboard-ready read of all five quantities.
- `src/t_gnn/motif_engine.py`'s Redis-outage graceful degradation (tasks.md 6.3) and `src/t_gnn/cold_storage.py`'s `BufferedColdStorageWriter` (tasks.md 6.4) are described in their own bullets above (Phase 3's and Phase 2's sections respectively) — both are Phase 6 additions to earlier-phase modules, not new modules of their own, so they're documented alongside the code they modify rather than repeated here.
- `tests/test_chaos.py` (tasks.md 6.5) is one test per row of design.md §5's Failure Modes table: a 1000-edge ingest spike forcing epsilon toward `epsilon_max` under size pressure then relaxing once calm (Flink backpressure's proxy, since no real Flink job exists to generate literal backpressure); a simulated Redis outage (`redis.exceptions.ConnectionError`) showing `MotifEngine` disables cleanly while `BaselineStore`/`DecayEngine` proceed unaffected on the same edges; intermittent Neo4j latency spikes showing `PruningWatcher.run_once()` never stalls and every write eventually lands via `BufferedColdStorageWriter`; and a misconfigured `λ_p` producing a prune-rate spike fully visible in `AuditLogger`'s records, corrected via `ProtocolDecayRegistry.reload()` with no redeploy.
