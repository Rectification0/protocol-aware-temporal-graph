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

### Backend status (`main`)

Every phase in `tasks.md` (0–8) has code; further backend work is enhancement/extension
(remaining Backlog items, Open Questions), not a new phase.

| Phase | Status |
|---|---|
| 0 Foundations | Complete |
| 1 Decay | Framework-agnostic Python (decay/baseline/deviation) — stands in for a future Flink job; see Architecture. |
| 2 Pruning | Mixed: Active Graph Store/Pruning Watcher are framework-agnostic; Neo4j cold-storage write path is real, running against `docker-compose.yml`. |
| 3 Motif Caching | Mixed: motif schema/registry + engine delta logic are framework-agnostic; Redis-backed motif-state store is real, with prune→reset wiring live via Phase 2's `PruneEventBus`. |
| 4 Cold Storage/Forensics | Entirely real — read-only query layer over Phase 2's live Neo4j data. |
| 5 T-GNN Integration | Real PyG forward pass over the live `ActiveGraphStore`; model architecture is deliberately small/untrained (specs.md §4 non-goal), not the integration. |
| 6 Observability/Hardening | `MetricsCollector`/`AuditLogger` are framework-agnostic aggregators (no dashboard/log-shipping pipeline exists yet); `MotifEngine` hardening (6.3) and `BufferedColdStorageWriter` (6.4) are real, load-bearing. |
| 7 Docs/Rollout | `docs/configuration-reference.md`/`operational-runbook.md` are real, complete. `pilot.py` (7.3) is a real, tested harness — but running it against real labeled traffic for a go/no-go call is an operational step this repo can't perform itself (same gap as task 0.4's dataset acquisition). |
| 8 Tooling follow-ups | `score_entities.py` CLI + a PowerShell doc fix, both real, discovered as gaps while using Phase 7's CLIs. |

**Backlog:** B.3 (`adaptive_calibration.py`), B.4 (fuzzy motif matching), B.5 (sharding), B.6 (`feedback.py`) are real, tested extensions — see Architecture. B.1/B.2 (a real Flink job) are deliberately unattempted: PyFlink for this stack's Flink 1.18 only supports Python 3.8–3.10 against this env's Python 3.12, and there's no message broker in `docker-compose.yml`. B.7 (real enterprise-scale NFR validation) is an operational gap like 0.4/7.3 (though `tests/test_load.py` has two opt-in proxy benchmarks via `RUN_HEAVY_LOAD_TEST=1`). B.8 (Mordor/OTRF ingestion adapter) is implemented and tested but deliberately kept off `main`, on `feature/mordor-ingestion`.

### Frontend status (`frontend_implementation` branch — NOT merged to `main`, per developer instruction)

A React SOC dashboard, planned across Milestones F0–F17 in `tasks.md`'s "Frontend Implementation" section (only exists on this branch). **Milestones F0–F14 are complete**; F15–F17 remain — check `tasks.md` for current status before starting new frontend work.

Key standing decisions:
- The API is a **decoupled, stateless reader** (FastAPI/uvicorn) — never constructs `ActiveGraphStore`/`MotifEngine`/`TGNNInferenceEngine` itself, only reads what a separately-running pipeline process persisted to Postgres/Neo4j.
- Real login (F0.11) is deliberately deferred in favor of a mock-auth bypass (free-text analyst name, no password/credential store client-side) — needs a real product decision first (who are "users," what do they authenticate against).
- F0.12 (cybersecurity score formula), F0.13 (IP/device/session-history fields — would need an `edge.schema.json` change), F0.14 (geo attack-map data, blocked on F0.13) are unstarted `[BACKEND TODO]` items — genuine data-model gaps, not oversights. Every "pending" panel in the frontend names one of these rather than fabricating data.
- No browser-automation tool has been available in any frontend session — every milestone's components are covered by unit/component tests (Vitest + RTL) and `npm run build`/`dev` transform checks, but live-backend visual verification has not been done. Treat this as a standing caveat, not per-milestone.

## Milestone summaries (frontend_implementation)

**F0 — Backend API layer.** `src/t_gnn/api_state.py` (`ApiStateWriter`/`ApiStateReader`) bridges the pipeline and API processes via Postgres (`t_gnn_dev`): tables for `users`, `metrics_snapshots`, `entity_scores` (upserted, latest-only), `motif_completions`, `motif_resets`, `motif_feedback`, `alert_acknowledgements`. `ApiStateWriter` auto-subscribes to the existing event buses and degrades gracefully on Postgres outage (mirrors `motif_engine.py`'s Redis-outage handling). `src/t_gnn/api/` is the FastAPI app: routers for metrics, scores, motifs (+ feedback POST), forensics, config, alerts, health, audit (F0.8), and an SSE stream (F0.10, `GET /api/stream/events` — a polling loop dressed as push, since the API process has no live bus of its own to relay). F0.11–F0.14 deferred as above.

**F1 — Project setup.** Vite/React 19/TS scaffold. Replaced Vite's default `oxlint` setup with ESLint (flat config) + Prettier per F1.2. Husky/lint-staged needed a nonstandard `prepare` script because `frontend/` is nested below the git root (husky's `.git` detection fails from a subdirectory cwd). Path alias `@` → `./src` (Vite + `tsconfig.app.json`, kept in sync by hand). Recharts/Zustand installed but unwired until their owning milestones (F5/F12); TanStack Query's `QueryClientProvider` is wired immediately since F4 needs it.

**F2 — Routing & app shell.** `react-router-dom@7` data router. F5.1/F5.2 (Navbar/Sidebar) pulled forward since F2.2 depended on both. `src/config/routes.ts` is the single source of truth for `ROUTES`/`NAV_ROUTES`. Code splitting via React Router's native `lazy` route field. `npm audit`'s one high-severity advisory is RSC-mode-only and inapplicable to this plain client-side SPA — kept the current version.

**F3 — Authentication.** `useAuthStore` (Zustand, in-memory only, no `persist`) holds `{analyst, expiresAt}` — reload loses the session by design; no refresh-token strategy since there's no real token yet. `LoginPage` branches on `VITE_MOCK_AUTH_ENABLED`. `ProtectedRoute` checks `isSessionValid()`. The other half of F3.2 (401 → redirect) landed with F4's API client.

**F4 — API integration layer.** Hand-written typed client (`types/api.ts` mirrors `schemas.py` field-for-field) rather than OpenAPI codegen — the surface is 9 small, rarely-changing routers; revisit if drift becomes a real risk. `src/hooks/api/` has one TanStack Query hook per endpoint, cadence tuned per data's real update rate. `queryClient.ts` centralizes retry policy (5xx/network only, 3 attempts, mutations never retry) and a global 401 handler (logout + redirect). `api/liveStream.ts`'s `LiveStreamManager`/`useLiveStream()` is a hand-rolled SSE client with exponential backoff (not relying on native `EventSource` reconnect); installed/tested but not mounted until F7.4/F13.

**F5 — Reusable UI component library.** Found already fully implemented in the working tree when F4 landed (F5.3–F5.14; F5.1/F5.2 already pulled into F2) — verified against tasks.md and the full lint/format/test/build chain, then checkboxes flipped. Worth remembering: the working tree can race ahead of tasks.md/CLAUDE.md.

**F6 — Executive Dashboard.** First data-driven page. `features/dashboard/logic.ts` holds pure derivations (`computeSecurityLevel`/`computeThreatStatus`/`computeMonitoringStatus`) — note `computeSecurityLevel()` takes `Math.abs()` internally after a real bug where a caller passed a raw negative score. Six `StatCard` tiles, each independently data-fetching. `CybersecurityScoreTile` has no real backend (F0.12 gap) so stays in an empty state. Fixed an unrelated flake: React Router's `lazy` routes render nothing during hydration without a `HydrateFallback` — added `RouteHydrateFallback` + raised the suite's async test timeout.

**F7 — Threat Analytics.** New `AnalyticsPage.tsx`/`features/analytics/`. `classifyEntityScore()` reuses F6.2's exact magnitude thresholds under a 3-tier vocabulary (`suspicious`/`malicious`), explicitly captioned as provisional/not-calibrated in the UI itself, not just code. Trend/severity charts sample the same top-500-by-|score| page (backend caps `limit` at 500) — an honest sampling caveat, not full history (`entity_scores` is upsert/latest-only). `LiveAttackCounter` is F4.6's first real SSE mount. Fixed two more test-infra gaps: jsdom has no `EventSource` (added a no-op stub) and Vitest's per-test timeout needed raising alongside RTL's async timeout.

**F8 — Time-Based Analytics.** Needed real backend work: `start`/`end` query params + exact-`COUNT(*)` `total` on `/api/scores/entities` and `/api/motifs/completions` (only when a bound is supplied — unfiltered calls unaffected), and a new `GET /api/pilot/latest-report` (reads whatever file `pilot.py --output` wrote, honestly labeled "as of last pilot evaluation," not live). `timeRangeStore.ts` (Zustand) holds the shared selected range; F7's tiles/charts were updated to consume it. `buildThreatTrendSeries()` generalized from a fixed 24-hourly-bucket window to a fixed bucket *count* spread across whatever range is selected. Same recurring test-timeout flake surfaced again — root cause this time was `setup.ts`'s `asyncUtilTimeout` (a different knob than `testTimeout`), raised to 20000ms.

**F9 — Detection Matrix.** No backend changes needed — F0.3/F0.4 and the F9.5 feedback endpoint (added ahead of schedule in F0) already covered it. `features/detections/logic.ts`: motif-path detections floor at "medium" severity (a structural match is never low-severity, even fuzzy/low-confidence); anomaly-path severity interpolates F6.2/F7.1's exact thresholds, with the "low" floor deliberately aligned to F7.1's "non-benign" cutoff so the two pages agree on what counts as a detection. Anomaly rows are filtered to `trigger === "scheduled"` to avoid double-counting a motif-triggered rescore. TP/FP disposition buttons work for motif-path rows only (`motif_feedback` has no anomaly-path equivalent); Investigation status is a static "New" badge — no backing concept exists anywhere in the repo.

**F10 — User Investigation.** Needed three real backend additions: `GET /api/entities` (Neo4j `list_entities`/`count_entities` — the only viable data source since this process never holds a live graph; consequently an entity with only active, not-yet-pruned edges won't appear — a cold-storage view, documented in the UI), a point-lookup `GET /api/scores/entities/{id}`, and a `chain_key` filter on motif completions. `UserListPage`/`InvestigationPage` assemble these plus F5 components; F10.4/F10.6 are deliberately the same panel (not two, since there's only one data source); F10.7–F10.9 are `BackendPendingState` panels naming F0.13, declining to fabricate session boundaries.

**F11 — Log Explorer.** Backend: `read_records()` gained `q` (freetext substring), `until`, and `entity` filters (composed into the existing full-file-scan). `features/logs/logic.ts`: `classifyLogSeverity()` floors motif-reset records at "medium" (a discarded partial chain is never routine) and derives prune severity from `w_at_prune` (illustrative thresholds). Export (F11.5) is scoped to the current fetched page only, stated in the UI. F11.7's "no silent reordering" requirement meant opting this page out of `useAuditLog`'s normal polling and out of `liveStream.ts`'s prune-triggered invalidation for the audit-log query key — instead new prune/motif-reset events are read directly from the live-stream store, filtered against active criteria, and surfaced as dismissible "N new — Refresh" banner rows rather than silently reordering the visible page.

**F12 — Analytics Visualizations.** Pure frontend consumer, no backend changes. Three of eight tasks (F12.1/F12.2/F12.4) needed no new component — they're already covered by F7's `ThreatTrendsChart`/`ThreatSeverityChart` (documented as reuse, not omission). Five new components: detection-accuracy chart (reuses F8.4's pilot report), a geo-map `BackendPendingState` (F0.14), an attack-frequency heatmap (UTC-bucketed, not local time, so it can't disagree across analysts' timezones), top-targeted-resources and attack-pattern charts (both derived from `Machine:*` chain keys/entity ids since neither source endpoint carries a `dst` field — a deliberate, documented deviation from tasks.md's literal wording).

**F13 — Live Monitoring.** No backend changes. The one real architectural fix: `useLiveStream()` was previously only mounted by F7.4's counter (opening a connection per mount), so F6/F9's tiles never got live pushes. `AppShell` now owns the single shared connection for the whole authenticated app; other consumers read the shared store. New Zustand stores: `notificationsStore` (unread tracking), `alertAckStore` (session-scoped ack state — not server-hydrated, since `alerts.py` has no GET/list endpoint), `autoRefreshStore` (drives `useMetricsSnapshot`/`useHealth`'s polling interval, the two hooks with no SSE event type). `AckButton`, `LiveEventFeed`, `CriticalAlertsPanel`, `NotificationsPanel` (bell + dropdown, careful not to use `DropdownMenuItem` for rows since Radix auto-closes on item click) round out the milestone.

**F14 — Company Security Overview.** Backend: `MetricsCollector` gained a lifetime `total_edges_processed` counter (this repo's first real `ALTER TABLE` migration, since the table might already exist in a dev database) fed from `run_pipeline.py`; and `ApiStateReader.average_response_time()` (new `GET /api/alerts/response-time`) is the first consumer of `list_alert_acknowledgements()` (real since F13.6, previously unused) — parses the trailing timestamp out of each `detection_ref`, averaged in Python (not SQL, to avoid a Postgres-14+-only string function for an infrequent aggregate). `SecurityOverviewPage` mostly reuses F6 tiles as-is (F14.1/F14.2) plus three new tiles for monitored-users count, processed-logs count (explicit `en-US` locale formatting — a real bug caught by a locale-sensitive test), and average ack response time.

## End-of-phase / end-of-milestone checklist

When every checkbox in a `tasks.md` phase (Phase 0-8, Backlog items) **or
a frontend Milestone (F0-F17, on the `frontend_implementation` branch)** is
flipped to done, before moving on:

1. **Update this file.** Revise the phase-status table / frontend-status section to
   reflect what's newly done and why anything adjacent was deliberately
   skipped, extend the Architecture section with whatever new load-bearing
   abstractions/conventions that phase/milestone introduced, and add any
   new commands. Keep it a living doc, not a snapshot of whichever phase
   was current when it was last touched.
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
3. **Re-check `.gitignore`.** Scan for anything the phase's/milestone's
   work generates that isn't already covered — new build/cache artifacts
   (e.g. a new toolchain's equivalent of `*.egg-info/`; a frontend
   milestone landing `frontend/` will eventually need its own
   `node_modules/`/`dist/`/build-cache entries), new local data/output
   directories, new env/credential files — and add entries before
   committing. Do this even when the diff looks small; it's cheap and the
   failure mode (a secret or a multi-hundred-MB directory landing in a
   commit) isn't.
4. **Include all of the above in the phase's/milestone's commit(s).** These
   doc/config updates land in the same commit(s) as the phase's/milestone's
   code, not a follow-up commit — so `git log` never shows a phase or
   milestone "done" with its docs still pointing at the previous state.
5. **Ask the developer before committing or pushing.** Finishing a phase's/
   milestone's code and docs (1-3 above) does not itself mean "create the
   commit(s)" or "push branch" — those are separate, explicit asks. Once the
   work described above is ready, stop and summarize what would be
   committed (files changed, proposed commit message(s), target branch) and
   wait for the developer's go-ahead before running `git commit`/`git push`.
   This applies even though step 4 says the doc/config updates belong in
   the same commit as the code — that's guidance for *what* to bundle
   together whenever a commit does happen, not a standing authorization to
   commit automatically at the end of a phase/milestone.

## Commands

```bash
pip install -e ".[dev]"                 # install package + pytest
pytest                                   # run full test suite
pytest tests/test_schema.py              # run one test file
pytest tests/test_schema.py::test_round_trip_json   # run one test
python scripts/init_postgres.py          # idempotent: create the t_gnn_dev database
python -m t_gnn.data.stage_lanl --input <auth.txt.gz> --output <dir>   # stage LANL dataset
python -m t_gnn.data.calibrate_decay --staged-dir <dir> [--output report.json]   # suggest lambda_p per protocol from staged edges
python -m t_gnn.data.simulate_traffic --output-dir <dir> [--num-users 200] [--num-machines 50] [--days 7] [--seed 42]   # generate synthetic labeled traffic for pilot.py
python -m t_gnn.pilot --staged-dir <dir> --redteam <redteam.txt> [--z-threshold 3.0] [--output report.json]   # false-positive/negative rates vs. labeled ground truth
python -m t_gnn.score_entities --staged-dir <dir> [--top 20] [--output scores.json]   # replay staged edges and print live T-GNN per-entity scores
docker compose up -d                     # bring up Flink/Redis/Neo4j (needed for the Neo4j and Redis integration tests)
```

There is no lint/format/build step configured for the Python backend.
`frontend_implementation` branch only: the `frontend/` app has its own
lint/format/build/test commands (`npm run lint`/`format`/`build`/`test`)
-- see `frontend/README.md`'s Commands section, not this one.

`python -m t_gnn.data.stage_mordor` (Backlog B.8, stages an OTRF/Security-Datasets
"Mordor" capture) lives on the separate `feature/mordor-ingestion` branch, not on
`main` — see that branch's `CLAUDE.md`/`docs/cli-reference.md` for its command
and flags. Kept off `main` at the developer's request rather than merged in.

## Local dev database — read before adding any persistence code

`docker-compose.yml`'s Flink/Redis/Neo4j stack (`docker compose up -d`) is
running for local dev: Flink UI on `localhost:8081`, Neo4j on
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
before this stack existed, and is now also where F0's `api_state.py`
tables live (users, metrics_snapshots, entity_scores, motif_completions,
motif_resets, motif_feedback, alert_acknowledgements). Keep using it for
persistence needs that *don't* map to Flink/Redis/Neo4j's roles, or that
the API layer needs; create tables only when a task actually needs them.

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
same edge shape, kept in lockstep across two representations:

- `config/schema/edge.schema.json` — the language-agnostic JSON Schema (authoritative for field set/types/enums).
- `src/t_gnn/schema.py` (`Edge` dataclass) — `.validate()` against the JSON Schema, `to_json`/`from_json` for round-tripping, `make_edge_id()` for the deterministic Redis/Neo4j/graph-store key.

Node ids are `"<Type>:<name>"` (e.g. `"User:alice"`, `"Machine:C1042"`);
`Edge.__post_init__` infers `src_type`/`dst_type` from that prefix. Edge
type is `Authentication`/`FileTransfer`/`RemoteCodeExecution` (FR5.2);
protocol is `RDP`/`SMB`/`Kerberos`/`DNS` (FR1.2) and selects the decay
constant, loaded via `config/protocols.yaml` + `protocol_registry.py`
(`ProtocolDecayRegistry`) — explicitly a placeholder for eventual Flink
broadcast state (design.md §2.2, tasks.md 1.1/1.2).

**Phase 1 — decay/baseline/deviation (framework-agnostic Python):**
- `decay.py` (`compute_weight()`, `DecayEngine`) — FR1.1/1.3: `w(e,t) = w_0 · e^(-λ_p·(t-t_e))`, clamped at zero elapsed time; `refresh()` returns a new `Edge`, never mutates.
- `baseline.py` (`EWMABaseline`, `BaselineStore`, `DeviationSignal`) — FR1.4/1.5: EWMA mean/variance keyed by `(entity=edge.src, protocol)`; `z_score` computed before folding in the new observation, `None` until ≥2 prior samples with nonzero variance exist.
- `streaming.py` (`DecayStreamProcessor`) — ties the two into the per-edge step a future Flink `ProcessFunction` will wrap.
- `data/calibrate_decay.py` (`calibrate()`) — suggests λ_p per protocol from median same-entity inter-arrival gap in staged LANL edges; only reports when `min_samples` is cleared, else defers to the registry's current value.

**Phase 2 — dynamic graph pruning (mixed):**
- `graph_store.py` (`ActiveGraphStore`) — FR2/NFR3: hash map + per-node adjacency sets, one `RLock`. `to_pyg_edge_index()` materializes current state fresh on every call (Phase 5's forward pass is the intended caller).
- `pruning.py` (`EpsilonController`, `PruneEventBus`, `PruningWatcher`) — FR2.2/2.3/2.5: epsilon = max(real memory pressure via `psutil`, graph-size pressure) interpolated between `epsilon_min`/`epsilon_max`. `PruningWatcher.run_once(t)` is synchronous/testable; `start()`/`stop()` wrap it in a daemon thread. Cold-storage write happens *before* removal (FR2.4) — failure leaves the edge active for retry. `PruneEventBus` is in-process pub/sub with three real subscribers so far (`MotifEngine.on_prune`, `AuditLogger.log_prune`, `MetricsCollector`).
- `cold_storage.py` (`Neo4jColdStorageWriter`, `InMemoryColdStorageWriter`, `BufferedColdStorageWriter`) — FR2.4/FR4.2: real `neo4j` Bolt driver writes of `(Entity)-[:PRUNED_EDGE]->(Entity)` against the compose stack, with indexes on `Entity.id` and `PRUNED_EDGE.pruned_at`. `BufferedColdStorageWriter` (6.4) is a drop-in wrapper added in Phase 6.

**Two ingestion adapters** both produce `Edge` instances (design.md §2.9) — `ingestion/sysmon_adapter.py` (dispatches on Sysmon/Security EventID to reconstruct the two-hop lateral-movement motif; protocol inference is a documented heuristic) and `data/stage_lanl.py` (LANL `auth.txt.gz` → sharded NDJSON `Edge`s). A third source should follow the same pattern: parse into `Edge`, don't invent a parallel representation.

**Phase 3 — motif caching (mixed):**
- `config/schema/motif.schema.json` + `motifs.py` (`MotifStep`, `MotifDefinition`, `MotifRegistry`) — FR3.1/3.5: ordered structural steps + a `window_seconds` bound. `key_resolver` is the extensibility seam — `"identity"` and `"host_admin"` (a documented naming-convention heuristic) exist today; new entity-linkage semantics need a new `KeyResolver`.
- `motif_engine.py` (`MotifEngine`, `RedisMotifStateStore`, `InMemoryMotifStateStore`, `MotifAlertBus`, `MotifResetBus`) — FR3.2–3.5: `on_edge()` does a direct chain-key lookup per definition (no scan). `RedisMotifStateStore` is genuinely wired to the compose Redis, with `EXPIRE` set to `window_seconds` per write (tasks.md 3.7). `on_prune()` (FR3.3, tasks.md 3.6) is auto-subscribed to `PruneEventBus` and uses the reverse edge-id index to clear dependent partial matches, publishing a `MotifResetEvent`.
- Redis-outage graceful degradation (6.3, NFR4): all state-store calls go through `_state_*` wrappers that catch `RedisError`, flip `self.available` (logged once), and treat failures as "no match" until Redis returns. `BaselineStore`/`DecayEngine`/`TGNNInferenceEngine` have no Redis dependency, so FR1.5 is unaffected.

**Phase 4 — forensics.** `forensics.py` (`Neo4jForensicQueryAPI`) is a read-only layer over Phase 2's exact `PRUNED_EDGE` shape — no second schema. `reconstruct_activity()` implements design.md 2.7 verbatim; `get_edge()` is the point-lookup complement.

**Phase 5 — T-GNN integration.** `tgnn.py` (`DynamicTGNN`, `EntityFeatureTable`, `TGNNInferenceEngine`, `InferenceResultBus`) — `score_entities()` calls `to_pyg_edge_index()` fresh every time (a pruned edge is simply absent next pass). `EntityFeatureTable` is the stable node-id→embedding-row registry `to_pyg_edge_index()` doesn't provide on its own. `observe_deviation()` concatenates the latest z-score as a real input feature. `on_motif_completion()` auto-subscribes to `MotifAlertBus` for the 5.3 fast path. The two-`SAGEConv` model is deliberately untrained (specs.md §4 non-goal) — swappable later without touching the engine. `tests/test_tgnn_e2e.py` exercises both the anomaly path (5.4) and the motif-driven fast path (5.5) against real earlier-phase components.

**Phase 6 — hardening (not a new stage):**
- `audit.py` (`AuditLogger`, `FileAuditSink`, `InMemoryAuditSink`) — subscribes to `PruneEventBus`/`MotifResetBus`, writes NDJSON.
- `metrics.py` (`MetricsCollector`, `RollingRateCounter`) — active graph size read live; prune/motif-hit/motif-reset rates from bus subscriptions ("hit" = a full `MotifCompletionEvent`); epsilon/inference-latency series from explicit `observe_*` calls; `snapshot()` is the single dashboard-ready read. `total_edges_processed` (a lifetime counter, added in F14) is the one non-rate quantity.
- `MotifEngine`'s Redis degradation (6.3) and `BufferedColdStorageWriter` (6.4) are documented in Phases 3/2 above.
- `tests/test_chaos.py` (6.5) — one test per design.md §5 failure mode: ingest-spike epsilon response, Redis outage, Neo4j latency spikes, misconfigured λ_p correction via `reload()`.

**Phase 7 — docs + pilot tool.** `docs/configuration-reference.md`, `operational-runbook.md`, `docs/cli-reference.md` (ad hoc, post-Phase-8) are real and complete — keep current per the checklist above. `pilot.py` (`evaluate_anomaly_detection()`, `evaluate_motif_detection()`, `run_pilot()`) computes real TP/FP/FN/TN rates against LANL `redteam.txt`-format labels; only a tiny synthetic fixture is vendored, so its own test asserts a correct miss, not a fabricated detection. `data/simulate_traffic.py` generates synthetic labeled traffic at configurable scale (background traffic is structurally incapable of colliding with either seed motif's shape, so every completion in a simulated run is a true positive by construction).

**Phase 8 — tooling follow-ups.** `score_entities.py` closes the gap that `pilot.py` never actually drives the PyG forward pass: replays staged edges through the same `DecayStreamProcessor`/`MotifEngine`, with `TGNNInferenceEngine` wired to `MotifAlertBus` for inline fast-path scoring, then one final scheduled pass over the remaining graph.

**Backlog B.3–B.6** (real, tested extensions):
- `adaptive_calibration.py` (`AdaptiveDecayCalibrator`) — B.3: online counterpart to `calibrate_decay.py`, reapplying its `ln(2)/median_gap` heuristic every N edges, clamped by `max_relative_change`; writes via a new `ProtocolDecayRegistry.update()` (in-memory only).
- `motifs.py`'s `match_score()` + `motif_engine.py`'s `fuzzy=`/`min_confidence=` — B.4: partial credit on `edge_type`/`protocol` substitution (never on `src_type`/`dst_type`); `fuzzy=False` is byte-for-byte pre-B.4 behavior.
- `sharding.py` + `ShardedActiveGraphStore`/`ShardedMotifStateStore` — B.5: SHA-256-based stable shard routing (not Python's salted `hash()`); real partitioning logic, though each shard would need a real RPC layer between processes for a genuine deployment.
- `feedback.py` (`MotifFeedbackBus`, `MotifPriorityTracker`) — B.6: Laplace-smoothed true-positive-rate priority scoring per motif from analyst dispositions; downstream-only, no change to detection logic.

`scripts/run_pipeline.py` (ad hoc, not a tasks.md item) wires every real component above into one long-running process, with `--source synthetic` (default) or `--source replay --staged-dir <dir>`. Verified running live against the real compose stack in both modes. Doesn't wire in B.6's tracker/bus (that loop is human-driven).

### Frontend architecture notes

**F0.** `api_state.py` bridges pipeline↔API via Postgres; FastAPI routers give every error the same `{"error": {code, message}}` envelope; `schemas.py`'s `Paginated[T]` (offset-based) is the universal list envelope. SSE stream (`stream.py`) polls Postgres/the audit file on a configurable interval and emits named events plus heartbeats — a push interface over a polling implementation, an honest consequence of the decoupled-process decision.

**F1–F4.** Path aliases, ESLint+Prettier, TanStack Query wired at F1; routing/shell/code-splitting at F2; mock-auth session (in-memory Zustand, no persistence) at F3; a hand-written typed API client + one query hook per endpoint + centralized retry/401 handling + a hand-rolled reconnect-with-backoff SSE client at F4 (`src/api/liveStream.ts`, `src/store/liveStreamStore.ts`).

**F5.** Full shared component library (`stat-card`, `data-table`, `charts`, `filter-bar`, `search-bar`, `date-range-picker`, `confirm-dialog`, `alert-banner`, `toast`, `skeletons`, `empty-state`, `severity-badge`, plus shadcn `ui/` primitives) — `SeverityBadge`'s 5-tier vocabulary (`critical`/`high`/`medium`/`low`/`info`) is specifically threat-detection severity; don't stretch it onto unrelated status concepts (see `status-pill.tsx`'s separate tonal-dot pattern for infra/connection status).

**F6–F14 feature folders**, each with a pure `logic.ts` + thin components, one per page/section: `features/dashboard/`, `features/analytics/` (also owns `timeRangeStore.ts`, shared from F8 onward by F7/F9/F11/F12), `features/detections/` (severity derivation reused by F11/F13), `features/investigation/`, `features/logs/`, `features/monitoring/` (owns `notificationsStore`, `alertAckStore`, `autoRefreshStore`; `AppShell` is the single `useLiveStream()` owner for the whole app), `features/security-overview/`. Recurring conventions worth knowing before adding a new tile/page: reuse an existing threshold/derivation rather than inventing a second one when two pages need the same "is this bad" judgment; name the exact `[BACKEND TODO]` gap (F0.12/F0.13/F0.14) via `BackendPendingState` rather than fabricating data; caption every provisional/sampled/non-live number in real UI copy, not just a code comment.

Every milestone's frontend work also required, at minimum: `npx tsc -b --noEmit`, `npm run lint`, `npm run format:check`, `npm run build`, `npm run test` passing clean — run these after any frontend change here, not just at milestone boundaries.
