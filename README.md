# t_gnn

Protocol-Aware Asymmetric Decay and Stateful Motif Pruning in CTDGs: a
real-time threat-detection system design for enterprise networks, built on
Temporal GNNs over Continuous-Time Dynamic Graphs.

See `functionality.txt` (blueprint), `specs.md` (requirements), `design.md`
(architecture), and `tasks.md` (implementation plan / status) for the full
design. `CLAUDE.md` has the detailed module-by-module architecture notes;
`docs/configuration-reference.md` and `docs/operational-runbook.md` cover
configuration and day-to-day operation; **[`docs/cli-reference.md`](docs/cli-reference.md)**
is a dedicated reference for every command-line tool in the repo (staging,
calibration, pilot evaluation, live scoring, and the continuous pipeline
driver) — start there if you just want to run something.

## Status

All eight phases in `tasks.md` are implemented: Foundations
(edge/protocol schema + ingestion adapters), Protocol-Aware Time-Decay
(FR1), Dynamic Graph Pruning (FR2), Stateful Motif Caching (FR3), Cold
Storage & Forensics (FR4), T-GNN Integration, Observability & Hardening,
Documentation & Rollout, and Tooling & Documentation Follow-ups. See
`tasks.md` for the per-task checklist — Phase 7's pilot-deployment task
(7.3) ships a real, tested evaluation harness, but running an actual
pilot against real labeled enterprise traffic remains an operational step
outside what this repo can perform.

- `config/schema/edge.schema.json`, `config/schema/motif.schema.json` -- the edge and motif definition contracts.
- `config/protocols.yaml`, `config/motifs.yaml` -- protocol decay constants and the seed motif library.
- `src/t_gnn/schema.py`, `src/t_gnn/protocol_registry.py` -- the `Edge` contract and its decay-constant registry.
- `src/t_gnn/decay.py`, `src/t_gnn/baseline.py`, `src/t_gnn/streaming.py`, `src/t_gnn/data/calibrate_decay.py` -- Phase 1: per-protocol decay, EWMA baseline/deviation, and LANL-based calibration.
- `src/t_gnn/graph_store.py`, `src/t_gnn/pruning.py`, `src/t_gnn/cold_storage.py` -- Phase 2: the Active Graph Store, the Pruning Watcher, and the Neo4j cold-storage write path (plus Phase 6's `BufferedColdStorageWriter`).
- `src/t_gnn/motifs.py`, `src/t_gnn/motif_engine.py` -- Phase 3: motif definitions and the Redis-backed delta-update/reset-on-prune engine (plus Phase 6's Redis-outage graceful degradation and `MotifResetEvent`/`MotifResetBus`, and Backlog B.4's optional fuzzy/probabilistic matching mode with a per-completion confidence score).
- `src/t_gnn/forensics.py` -- Phase 4: the forensic query API over Phase 2's Neo4j cold storage ("reconstruct activity around entity X in time window Y", point lookup by edge id).
- `src/t_gnn/tgnn.py` -- Phase 5: the PyTorch Geometric forward pass over the live Active Graph Store, with the FR1.5 deviation signal wired in as an input feature and motif completions (FR3.4) as a fast-path inference trigger.
- `src/t_gnn/audit.py`, `src/t_gnn/metrics.py` -- Phase 6: NFR5 audit logging for prune/motif-reset events, and a metrics collector for active graph size, prune/motif-hit/motif-reset rates, epsilon history, and inference latency.
- `src/t_gnn/pilot.py` -- Phase 7: the pilot-evaluation harness (false-positive/negative rates for both detection paths against labeled ground truth) and its `python -m t_gnn.pilot` CLI.
- `src/t_gnn/data/simulate_traffic.py` -- generates synthetic labeled traffic (background noise + injected motif/anomaly attacks) at a configurable scale, for exercising `pilot.py`/the detection pipeline locally beyond the tiny committed fixture -- still not a substitute for a real pilot against real enterprise traffic.
- `src/t_gnn/score_entities.py` -- Phase 8: replays staged edges through the real decay/baseline/motif pipeline into the live T-GNN (`TGNNInferenceEngine`, Phase 5) and prints per-entity scores via its `python -m t_gnn.score_entities` CLI -- the piece `pilot.py` never exercises on its own.
- `src/t_gnn/ingestion/sysmon_adapter.py`, `src/t_gnn/data/stage_lanl.py` -- the two reference ingestion adapters (Sysmon and offline LANL replay).
- `src/t_gnn/adaptive_calibration.py` -- Backlog B.3: continuous/online `λ_p` recalibration from a rolling window of live edges, reusing `calibrate_decay.py`'s median-gap heuristic instead of requiring a one-shot manual batch run.
- `src/t_gnn/sharding.py`, plus `ShardedActiveGraphStore` (graph_store.py) and `ShardedMotifStateStore` (motif_engine.py) -- Backlog B.5: distributes the Active Graph Store and motif-state cache across N shards via a process-stable consistent hash.
- `src/t_gnn/feedback.py` -- Backlog B.6: an analyst-feedback bus + priority tracker that turns true/false-positive dispositions of past motif completions into a per-motif priority score.

Backlog B.8 (a Mordor/OTRF-Security-Datasets ingestion adapter, `stage_mordor`) is implemented but kept on the separate `feature/mordor-ingestion` branch rather than merged here -- see that branch's `docs/cli-reference.md` for how to stage and replay a Mordor capture.

**This branch (`frontend_implementation`) additionally carries a new React SOC dashboard frontend, not merged into `main`.** `tasks.md`'s "Frontend Implementation" section (Milestones F0-F17) is the roadmap. Implemented so far: Milestone F0 (a backend API layer -- `src/t_gnn/api/`, `src/t_gnn/api_state.py` -- since this repo previously had no HTTP surface at all), Milestone F1 (the `frontend/` app scaffold -- Vite + React + TypeScript, ESLint/Prettier + commit hooks, TanStack Query wired, Recharts/Zustand installed, base folder structure, its own CI job), Milestone F2 (routing + app shell), Milestone F3 (mock-auth login/session/route-guarding -- real login is still blocked on backend-auth product decisions, F0.11), Milestone F4 (the typed API client, TanStack Query hooks per endpoint, centralized error/retry handling, pagination, and an SSE live-stream client wrapper -- unblocking the second half of F3.2's 401 redirect), Milestone F5 (the reusable UI component library -- data table, charts, filters, date-range picker, dialogs, toasts, skeletons, empty states, severity badges -- consumed by the milestones ahead), Milestone F6 (the Executive Dashboard -- the first real, data-driven page, six tiles combining F4's hooks with F5's `StatCard`, including an interim security-level/monitoring-status proxy documented as provisional pending F0.12), Milestone F7 (Threat Analytics -- user threat-tier counts, trend/severity charts, and F4.6's first real live-stream mount), Milestone F8 (Time-Based Analytics -- a shared time-range filter store plus range-scoped tiles, needing two real backend additions: `start`/`end` params on the scores/completions endpoints and a new `/api/pilot/latest-report`), Milestone F9 (the Detection Matrix -- merging motif completions and anomaly-path scores into one severity-ranked table with real TP/FP feedback for the motif path), Milestone F10 (User Investigation -- a Neo4j-backed entity list plus a per-entity risk/timeline/triggered-rules page, needing three real backend additions: `/api/entities`, a point-lookup score endpoint, and a `chain_key` filter on motif completions), Milestone F11 (the Log Explorer -- full-text/entity/time-range search over the prune/motif-reset audit trail, needing `q`/`until`/`entity` additions to `/api/audit/log`, with live-stream updates surfaced as an explicit "N new events" affordance rather than silently reordering the table), Milestone F12 (Analytics Visualizations -- five new charts, e.g. a detection-accuracy breakdown and a UTC attack-frequency heatmap; three of the eight tasks needed no new component since they're already satisfied by Milestone F7's existing threat-trend/severity charts, documented as reuse rather than duplicated), and Milestone F13 (Live Monitoring -- fixes the SSE live-stream connection to be a single, app-wide instance owned by the app shell rather than one page's own tile, so every page's tiles actually receive live pushes; adds a raw live-event feed, a critical-alerts panel, a notification bell with unread count/toasts, an auto-refresh control for the two endpoints outside the live stream, and the frontend half of alert acknowledgement whose backend endpoint landed back in Milestone F0). See `frontend/README.md` for frontend-specific setup/commands, and `CLAUDE.md`'s frontend-status paragraph and Architecture-section addendum for what's real vs. deliberately deferred (F0.11-F0.14, all blocked on a product/schema decision rather than just unbuilt).

## Local dev environment

```bash
cp .env.example .env       # then edit .env with your local credentials
pip install -e ".[dev]"
docker compose up -d       # Flink UI :8081, Neo4j :7474/7687, Redis :6379
python scripts/init_postgres.py   # optional: creates the t_gnn_dev Postgres database
```

`docker-compose.yml` brings up the Flink/Redis/Neo4j stack that Phase 2's
cold-storage writes and Phase 3's motif state actually run against. A
separate local Postgres instance (`t_gnn/db.py`) remains available for any
persistence need that doesn't map to one of those three systems; see
`CLAUDE.md`'s "Local dev database" section for the current split.

## Running the full pipeline live

`docker compose up -d` brings up real Neo4j/Redis, but nothing runs
continuously against them on its own -- each phase is otherwise exercised
individually by tests/CLIs. `scripts/run_pipeline.py` wires every real
component together into one long-running process, fed either by
continuously-generated synthetic traffic (there's no live production event
source in this repo -- see tasks.md Backlog B.1) or by replaying a real
staged dataset:

```bash
docker compose up -d
python scripts/run_pipeline.py
python scripts/run_pipeline.py --source replay --staged-dir data/lanl/simulated/staged
```

See **[`docs/cli-reference.md`](docs/cli-reference.md#run_pipeline-scriptsrun_pipelinepy)**
for the full flag reference, or the section below for every other CLI tool
in this repo.

## CLI tools

Every command-line tool in this repo (staging real/synthetic data,
calibration, pilot evaluation, live T-GNN scoring, and the continuous
pipeline driver above) is documented in
**[`docs/cli-reference.md`](docs/cli-reference.md)**, including a "which
tool do I need?" table and how they compose together.

Prints anomaly/motif alerts as they happen plus a periodic metrics
snapshot; writes structured audit records to `logs/audit.log`. Run
`python scripts/run_pipeline.py --help` for the full option list.

## Running tests

```bash
pip install -e ".[dev]"
pytest
```

Tests that need the live Neo4j or Redis instance `skip` (rather than fail)
if `docker compose up -d` hasn't been run.
