# CLI Reference

Every command-line tool in this repo, in one place. For *why* things are
built this way, see `design.md`/`specs.md`; for step-by-step operational
procedures (tuning `λ_p`, adding motifs, responding to an outage), see
[`operational-runbook.md`](operational-runbook.md); for every config
surface (protocols.yaml, motifs.yaml, `.env`, etc.), see
[`configuration-reference.md`](configuration-reference.md).

**Mordor ingestion (`stage_mordor`, Backlog B.8) lives on a separate
branch, not `main`.** Check out `feature/mordor-ingestion` for that tool
and its own copy of this doc (including the Mordor-specific tasks below).

## Which tool do I need?

| I want to... | Use |
|---|---|
| Generate synthetic labeled traffic to test with | [`simulate_traffic`](#simulate_traffic) |
| Stage the real LANL dataset for replay | [`stage_lanl`](#stage_lanl) |
| Stage a real Mordor (OTRF/Security-Datasets) capture | `stage_mordor` on the `feature/mordor-ingestion` branch |
| Check detection accuracy against labeled ground truth | [`pilot`](#pilot) |
| See the T-GNN's actual per-entity anomaly scores | [`score_entities`](#score_entities) |
| Derive a suggested `λ_p` per protocol from real traffic | [`calibrate_decay`](#calibrate_decay) |
| Watch the whole system run continuously, end to end | [`run_pipeline`](#run_pipeline-scriptsrun_pipelinepy) |
| Set up the local dev Postgres database (+ frontend API tables) | [`init_postgres`](#init_postgres-scriptsinit_postgrespy) |
| Serve the backend the frontend talks to (`frontend_implementation` branch) | [`t_gnn.api`](#t_gnnapi-python--m-t_gnnapi) |
| Run the frontend dashboard itself (`frontend_implementation` branch) | `npm run dev` in `frontend/` — see [this task](#task-turn-on-the-backend-api-and-frontend-dashboard) |

## How they fit together

```
                    ┌── stage_lanl ────┐
                    └── simulate_traffic ┘
                              │
                              ▼
                    staged/ (shard-*.jsonl,
                    the shared Edge format)
                              │
              ┌───────────────┼───────────────┬─────────────────┐
              ▼               ▼               ▼                 ▼
          calibrate_decay   pilot        score_entities    run_pipeline
                          (+ redteam)                     --source replay
```

`simulate_traffic` and `stage_lanl` are the two producers of staged data on
this branch (a directory of `shard-*.jsonl` files, each line a serialized
`Edge` — see `config/schema/edge.schema.json`; `feature/mordor-ingestion`
adds a third, `stage_mordor`). Every other tool below is a consumer of
that same format, so either producer can feed any of them — e.g. generate
synthetic traffic and run `pilot` against it, or replay it live through
`run_pipeline`.

### `frontend_implementation` branch only: the API + frontend layer

None of the tools above talk HTTP. On this branch, `run_pipeline` gained a
second output alongside its stdout/audit-log: it also persists to Postgres
(`ApiStateWriter`, on by default — `--no-api-persist` turns it off), which
a wholly separate process (`t_gnn.api`, FastAPI/uvicorn) reads from to
serve the `frontend/` dashboard. The API never runs the graph
store/motif engine/T-GNN itself — it's a decoupled, stateless reader:

```
run_pipeline.py  --writes-->  Postgres (t_gnn_dev) + Neo4j  <--reads--  python -m t_gnn.api
  (feeds itself synthetic                                                (FastAPI, :8000)
   traffic, or replays                                                        │
   staged/ from above)                                                        │ HTTP/SSE
                                                                                ▼
                                                                    frontend/ (Vite, :5173)
```

That means **three long-running processes in three terminals** to see the
dashboard populated with live data — see the
[cookbook task below](#task-turn-on-the-backend-api-and-frontend-dashboard)
for the exact commands, and [below that](#t_gnnapi-python--m-t_gnnapi) for
the `t_gnn.api` flag reference. `frontend/README.md` covers the frontend
side (env vars, npm scripts) in more detail.

---

## Common tasks (cookbook)

Full, copy-pasteable command sequences for the things people actually want
to do with this repo, task by task. Steps that appear in more than one task
(bringing the stack up, generating traffic) are repeated in full rather
than cross-referenced — every block below can be pasted on its own and
will work from a clean checkout.

### Task: set up the local dev environment from scratch

```bash
cp .env.example .env       # then edit .env with your local credentials
pip install -e ".[dev]"
docker compose up -d       # Flink UI :8081, Neo4j :7474/7687, Redis :6379
python scripts/init_postgres.py   # optional: only needed for Postgres-backed work
pytest                     # confirm everything (including Neo4j/Redis integration tests) is green
```

```powershell
Copy-Item .env.example .env       # then edit .env with your local credentials
pip install -e ".[dev]"
docker compose up -d               # Flink UI :8081, Neo4j :7474/7687, Redis :6379
python scripts/init_postgres.py    # optional: only needed for Postgres-backed work
pytest                             # confirm everything (including Neo4j/Redis integration tests) is green
```

### Task: turn on the backend API and frontend dashboard

`frontend_implementation` branch only. Three foreground processes, three
terminals, started in this order. Assumes the one-time setup above
(`.env`, `pip install -e ".[dev]"`, `python scripts/init_postgres.py`, and
`npm install` in `frontend/` with `frontend/.env.example` copied to
`frontend/.env.local`) is already done.

```bash
# terminal 1 — infra
docker compose up -d       # Neo4j :7474/7687, Redis :6379 (needed for cold storage/motif state)

# terminal 2 — feed the backend (synthetic traffic, forever; Ctrl+C to stop)
python scripts/run_pipeline.py --metrics-every 5

# terminal 3 — serve the API the frontend reads (never omit; persistence is on by default)
python -m t_gnn.api --reload

# terminal 4 — the dashboard itself
cd frontend && npm run dev   # http://localhost:5173
```

```powershell
# terminal 1 — infra
docker compose up -d

# terminal 2 — feed the backend
python scripts/run_pipeline.py --metrics-every 5

# terminal 3 — serve the API
python -m t_gnn.api --reload

# terminal 4 — the dashboard itself
cd frontend; npm run dev
```

Open `http://localhost:5173` and log in with any free-text analyst name
(mock auth — there's no real credential store yet, tasks.md F0.11). The
Executive Dashboard should populate from whatever `run_pipeline.py` has
written so far, with live updates arriving over SSE as new ticks process.
Don't pass `run_pipeline.py --no-api-persist` here — that flag exists for
running the pipeline in isolation (the rest of this doc's tasks), and
skips the exact Postgres writes the frontend depends on. The frontend's
entity-list/investigation page (tasks.md F10) only shows entities once
their edges have actually been pruned to Neo4j cold storage, so give it a
few `--metrics-every` cycles before expecting it to be populated. See
[below](#t_gnnapi-python--m-t_gnnapi) for `t_gnn.api`'s flags.

### Task: generate simulated traffic and replay it live through the full pipeline

This is the fastest way to see decay, pruning, motif detection, and T-GNN
scoring all running together against real Neo4j/Redis.

```bash
docker compose up -d
python -m t_gnn.data.simulate_traffic \
    --output-dir data/lanl/simulated \
    --num-users 200 --num-machines 50 --days 7
python scripts/run_pipeline.py --source replay --staged-dir data/lanl/simulated/staged
```

```powershell
docker compose up -d
python -m t_gnn.data.simulate_traffic `
    --output-dir data/lanl/simulated `
    --num-users 200 --num-machines 50 --days 7
python scripts/run_pipeline.py --source replay --staged-dir data/lanl/simulated/staged
```

Watch stdout for `[anomaly]`/`[prune]`/`[motif-alert]`/`[motif-reset]`
lines and periodic metrics snapshots as the injected `lateral_pivot`,
`admin_share_escalation`, and low-and-slow scenarios replay in timestamp
order; the run stops on its own once every staged edge is exhausted.

### Task: generate simulated traffic and check detection accuracy against ground truth

```bash
python -m t_gnn.data.simulate_traffic \
    --output-dir data/lanl/simulated \
    --num-users 200 --num-machines 50 --days 7
python -m t_gnn.pilot \
    --staged-dir data/lanl/simulated/staged \
    --redteam data/lanl/simulated/redteam.txt \
    --output pilot-report.json
```

```powershell
python -m t_gnn.data.simulate_traffic `
    --output-dir data/lanl/simulated `
    --num-users 200 --num-machines 50 --days 7
python -m t_gnn.pilot `
    --staged-dir data/lanl/simulated/staged `
    --redteam data/lanl/simulated/redteam.txt `
    --output pilot-report.json
```

`simulate_traffic` writes both the staged shards and the matching
`redteam.txt` labels in one shot, so this task never needs real data —
`pilot-report.json` will show precision/recall for both the
anomaly-deviation path and the motif-completion path.

`frontend_implementation` branch only: if `pilot-report.json` ends up at
the repo root (the default path above), `python -m t_gnn.api`'s
`GET /api/pilot/latest-report` serves it directly to the frontend's
Threat Analytics page (tasks.md F8.4) — set `PILOT_REPORT_PATH` if you
wrote it somewhere else. This is still a one-shot batch read of whatever
file existed at request time, not a live re-run of `pilot.py`.

### Task: generate simulated traffic and inspect the live T-GNN's per-entity scores

```bash
python -m t_gnn.data.simulate_traffic \
    --output-dir data/lanl/simulated \
    --num-users 200 --num-machines 50 --days 7
python -m t_gnn.score_entities \
    --staged-dir data/lanl/simulated/staged \
    --top 20 \
    --output scores.json
```

```powershell
python -m t_gnn.data.simulate_traffic `
    --output-dir data/lanl/simulated `
    --num-users 200 --num-machines 50 --days 7
python -m t_gnn.score_entities `
    --staged-dir data/lanl/simulated/staged `
    --top 20 `
    --output scores.json
```

Entities involved in an injected `lateral_pivot`/`admin_share_escalation`
should surface near the top of `scores.json` once the motif's fast-path
inference fires mid-replay — remember the underlying model is untrained
(specs.md §4's non-goal), so only relative score magnitude is meaningful.

### Task: generate simulated traffic and calibrate `λ_p` from it

```bash
python -m t_gnn.data.simulate_traffic \
    --output-dir data/lanl/simulated \
    --num-users 200 --num-machines 50 --days 7
python -m t_gnn.data.calibrate_decay \
    --staged-dir data/lanl/simulated/staged \
    --output calibration-report.json
```

```powershell
python -m t_gnn.data.simulate_traffic `
    --output-dir data/lanl/simulated `
    --num-users 200 --num-machines 50 --days 7
python -m t_gnn.data.calibrate_decay `
    --staged-dir data/lanl/simulated/staged `
    --output calibration-report.json
```

Then, if `sufficient_data` is `true` for a protocol and you want to apply
the suggestion, hand-edit `config/protocols.yaml`'s `half_life_hours` for
that protocol — see `operational-runbook.md`'s "Tuning `λ_p`" for the
full procedure, including how to `reload()` without a redeploy.

### Task: run the full pipeline continuously against synthetic (non-staged) traffic

No staging step needed — `run_pipeline`'s default `--source synthetic`
generates its own traffic forever.

```bash
docker compose up -d
python scripts/run_pipeline.py
# Ctrl+C to stop, or bound it up front:
python scripts/run_pipeline.py --max-ticks 200
```

```powershell
docker compose up -d
python scripts/run_pipeline.py
# Ctrl+C to stop, or bound it up front:
python scripts/run_pipeline.py --max-ticks 200
```

### Task: stage a real Mordor capture and replay it through the pipeline

Mordor ingestion isn't on this branch. Switch to `feature/mordor-ingestion`
first:

```bash
git checkout feature/mordor-ingestion
docker compose up -d
python -m t_gnn.data.stage_mordor \
    --input empire_psexec_dcerpc_tcp_svcctl.zip \
    --output data/mordor/staged
python scripts/run_pipeline.py --source replay --staged-dir data/mordor/staged
```

```powershell
git checkout feature/mordor-ingestion
docker compose up -d
python -m t_gnn.data.stage_mordor `
    --input empire_psexec_dcerpc_tcp_svcctl.zip `
    --output data/mordor/staged
python scripts/run_pipeline.py --source replay --staged-dir data/mordor/staged
```

See `data/mordor/README.md` on that branch for how to acquire a capture,
and that branch's `docs/cli-reference.md` for the full `stage_mordor` flag
reference and more Mordor-specific tasks (smoke-testing with the bundled
fixture, scoring instead of replaying live, etc.). There's no
`redteam.txt` for a Mordor capture — use `score_entities`/`run_pipeline`
to inspect it, not `pilot`.

### Task: stage the real LANL dataset and evaluate detection accuracy

Requires the real `auth.txt.gz`/`redteam.txt.gz` from the
[LANL Comprehensive Cybersecurity dataset](https://csr.lanl.gov/data/cyber1/)
— see `data/lanl/README.md` for acquisition.

```bash
python -m t_gnn.data.stage_lanl \
    --input auth.txt.gz \
    --output data/lanl/staged
python -m t_gnn.pilot \
    --staged-dir data/lanl/staged \
    --redteam redteam.txt \
    --output pilot-report.json
```

```powershell
python -m t_gnn.data.stage_lanl `
    --input auth.txt.gz `
    --output data/lanl/staged
python -m t_gnn.pilot `
    --staged-dir data/lanl/staged `
    --redteam redteam.txt `
    --output pilot-report.json
```

### Task: try the LANL/pilot smoke-test fixtures without downloading the real dataset

```bash
python -m t_gnn.data.stage_lanl \
    --input data/lanl/raw/sample_auth.txt.gz \
    --output data/lanl/staged-sample
python -m t_gnn.pilot \
    --staged-dir data/lanl/staged-sample \
    --redteam data/lanl/raw/sample_redteam.txt
```

```powershell
python -m t_gnn.data.stage_lanl `
    --input data/lanl/raw/sample_auth.txt.gz `
    --output data/lanl/staged-sample
python -m t_gnn.pilot `
    --staged-dir data/lanl/staged-sample `
    --redteam data/lanl/raw/sample_redteam.txt
```

Both fixtures are tiny by design — expect the pilot report to show a
correct *miss* (a false negative), not a fabricated detection; see
`tests/test_pilot.py` for the same assertion made as an automated test.

### Task: use sharding and fuzzy motif matching together (Backlog B.4/B.5)

```bash
docker compose up -d
python -m t_gnn.data.simulate_traffic --output-dir data/lanl/simulated
python scripts/run_pipeline.py --source replay --staged-dir data/lanl/simulated/staged \
    --shards 3 --fuzzy --min-confidence 0.6
```

```powershell
docker compose up -d
python -m t_gnn.data.simulate_traffic --output-dir data/lanl/simulated
python scripts/run_pipeline.py --source replay --staged-dir data/lanl/simulated/staged `
    --shards 3 --fuzzy --min-confidence 0.6
```

---

## Tool reference

Detailed flag-by-flag reference for every tool used above.

### `simulate_traffic`

Generates synthetic labeled enterprise traffic: benign
`User`→`Machine` authentication noise, plus injected instances of both
seed motifs (`lateral_pivot`, `admin_share_escalation`) and a "low and
slow" anomaly — all verifiably detectable, since background traffic can
never structurally collide with either injected pattern. Use this when you
don't have real data yet, or want a repeatable (same `--seed` = same
traffic) scenario to test against.

**Module**: `t_gnn.data.simulate_traffic`
**Prerequisites**: none.

```bash
python -m t_gnn.data.simulate_traffic \
    --output-dir data/lanl/simulated \
    --num-users 200 --num-machines 50 --days 7
```

```powershell
python -m t_gnn.data.simulate_traffic `
    --output-dir data/lanl/simulated `
    --num-users 200 --num-machines 50 --days 7
```

| Flag | Default | Meaning |
|---|---|---|
| `--output-dir` | *(required)* | Writes `<dir>/staged/` (shards) and `<dir>/redteam.txt` (labels) |
| `--num-users` | `200` | Number of distinct users in the simulation |
| `--num-machines` | `50` | Number of distinct machines |
| `--days` | `7.0` | Duration of the simulated capture window |
| `--events-per-user-per-day` | `3.0` | Background traffic density per user |
| `--num-lateral-pivots` | `3` | Injected `lateral_pivot` attack instances |
| `--num-admin-share-escalations` | `3` | Injected `admin_share_escalation` attack instances |
| `--num-anomalies` | `3` | Injected "low and slow" anomalous events |
| `--epoch-start` | `1451606400` (2016-01-01 UTC) | Real-epoch anchor for the simulated window |
| `--shard-size` | `100000` | Max edges per output shard file |
| `--seed` | `42` | RNG seed — same seed always reproduces the same traffic |

**Output**: prints a JSON summary (`edges_written`, `labels_written`,
`shards_written`, `staged_dir`, `redteam_path`).

---

### `stage_lanl`

Stages the real [LANL Comprehensive Cybersecurity dataset](https://csr.lanl.gov/data/cyber1/)
(`auth.txt.gz`) into the shared edge schema. The real multi-GB dataset
isn't vendored here — see `data/lanl/README.md` for acquisition. A tiny
synthetic fixture (`data/lanl/raw/sample_auth.txt.gz`) in the same column
format lets you smoke-test the tool without the real data.

**Module**: `t_gnn.data.stage_lanl`
**Prerequisites**: a local `auth.txt` or `auth.txt.gz` file.

```bash
python -m t_gnn.data.stage_lanl \
    --input data/lanl/raw/auth.txt.gz \
    --output data/lanl/staged
```

```powershell
python -m t_gnn.data.stage_lanl `
    --input data/lanl/raw/auth.txt.gz `
    --output data/lanl/staged
```

| Flag | Default | Meaning |
|---|---|---|
| `--input` | *(required)* | Path to `auth.txt` or `auth.txt.gz` |
| `--output` | *(required)* | Directory for staged NDJSON shards |
| `--epoch-start` | `1451606400` | Anchors LANL's relative-time offsets to a real epoch |
| `--shard-size` | `100000` | Max edges per output shard file |

**Output**: prints a JSON summary (`lines_read`, `edges_written`,
`lines_skipped`, `shards_written`) and writes `manifest.json` alongside the
shards (source file hash, same counts).

---

### `pilot`

Computes true/false positive/negative rates for both detection paths —
FR1.5's anomaly-deviation signal and FR3.4's motif-completion alert —
against labeled ground truth (a `redteam.txt`-format file). This is the
evaluation harness `tasks.md` 7.3 asks for; running it against *real*
labeled enterprise traffic and using the result for a rollout decision is
the one step this repo can't perform for you (see
`docs/operational-runbook.md`'s "Running a pilot evaluation").

**Module**: `t_gnn.pilot`
**Prerequisites**: a staged directory (from `simulate_traffic` or
`stage_lanl`) plus its matching `redteam.txt`.

```bash
python -m t_gnn.pilot \
    --staged-dir data/lanl/simulated/staged \
    --redteam data/lanl/simulated/redteam.txt
```

```powershell
python -m t_gnn.pilot `
    --staged-dir data/lanl/simulated/staged `
    --redteam data/lanl/simulated/redteam.txt
```

| Flag | Default | Meaning |
|---|---|---|
| `--staged-dir` | *(required)* | Directory of staged NDJSON shards |
| `--redteam` | *(required)* | Path to `redteam.txt`-format ground truth |
| `--epoch-start` | `1451606400` | Must match whatever anchored the staged edges |
| `--z-threshold` | `3.0` | \|z-score\| that counts as an anomaly flag |
| `--output` | *(none)* | Optional path to also write the JSON report to disk |

**Output**: JSON with `anomaly`/`motif` sections, each
`{true_positives, false_positives, false_negatives, precision, recall}`.

---

### `score_entities`

Replays staged edges through the real decay/baseline/motif pipeline into
the live T-GNN (`TGNNInferenceEngine`) and prints each entity's actual
model score — the piece `pilot` doesn't exercise, since `pilot` only
evaluates the deviation/motif signals feeding the model, not the model's
own output.

**Module**: `t_gnn.score_entities`
**Prerequisites**: a staged directory (from `simulate_traffic` or
`stage_lanl`).

```bash
python -m t_gnn.score_entities --staged-dir data/lanl/staged --top 20
```

```powershell
python -m t_gnn.score_entities --staged-dir data/lanl/staged --top 20
```

| Flag | Default | Meaning |
|---|---|---|
| `--staged-dir` | *(required)* | Directory of staged NDJSON shards |
| `--top` | *(none = all)* | Only report the N highest-magnitude scores |
| `--output` | *(none)* | Optional path to also write the JSON results to disk |

**Output**: a JSON list of `{entity_id, score, t, trigger, motif_name}`,
sorted by score magnitude descending. The underlying model is a
deliberately untrained reference network (specs.md §4's non-goal) — treat
scores as a way to verify the integration works, not as calibrated anomaly
probabilities.

---

### `calibrate_decay`

Derives a suggested `λ_p` per protocol from the median same-entity
inter-arrival gap in staged traffic — a calibration *aid*, not an
auto-apply step; a human still decides whether to hand-edit
`config/protocols.yaml`. For the *continuous*, auto-applying counterpart,
see `AdaptiveDecayCalibrator` (`src/t_gnn/adaptive_calibration.py`) — not
a CLI, since it's meant to run inline with live traffic (see
`scripts/run_pipeline.py --adaptive-calibration`).

**Module**: `t_gnn.data.calibrate_decay`
**Prerequisites**: a staged directory.

```bash
python -m t_gnn.data.calibrate_decay --staged-dir data/lanl/staged
```

```powershell
python -m t_gnn.data.calibrate_decay --staged-dir data/lanl/staged
```

| Flag | Default | Meaning |
|---|---|---|
| `--staged-dir` | *(required)* | Directory of staged NDJSON shards |
| `--output` | *(none)* | Optional path to also write the JSON report to disk |
| `--min-samples` | `30` | Minimum gap samples before trusting a suggestion over the current default |

**Output**: JSON list of `{protocol, sample_count, median_gap_seconds,
suggested_lambda_p, suggested_half_life_hours, current_lambda_p,
sufficient_data}` per protocol.

---

### `run_pipeline` (`scripts/run_pipeline.py`)

Wires every real component in this repo together into one long-running
process — decay/baseline, the Active Graph Store, pruning to real Neo4j,
motif detection against real Redis, live T-GNN scoring, metrics, and audit
logging. This is the only tool that shows the *whole system running*
rather than one stage in isolation.

**Prerequisites**: `docker compose up -d` (real Neo4j required; Redis
degrades gracefully if unreachable).

Two modes:

```bash
# synthetic (default): generates its own traffic forever, Ctrl+C to stop
python scripts/run_pipeline.py

# replay: replays a staged directory once, in timestamp order, then stops
python scripts/run_pipeline.py --source replay --staged-dir data/lanl/simulated/staged
```

```powershell
python scripts/run_pipeline.py
python scripts/run_pipeline.py --source replay --staged-dir data/lanl/simulated/staged
```

| Flag | Default | Meaning |
|---|---|---|
| `--source` | `synthetic` | `synthetic` (infinite, Ctrl+C to stop) or `replay` (finite, stops when exhausted) |
| `--staged-dir` | *(none)* | Required with `--source replay` |
| `--num-users` | `30` | Synthetic mode only |
| `--num-machines` | `10` | Synthetic mode only |
| `--tick-delay` | `0.05` | Wall-clock seconds to sleep between edges (human pacing only) |
| `--attack-every` | `30` | Synthetic mode only: inject one attack scenario every N ticks |
| `--metrics-every` | `25` | Run a pruning + inference pass and print a metrics snapshot every N ticks |
| `--z-threshold` | `3.0` | \|z-score\| to print as an anomaly |
| `--epsilon-min` | `0.05` | `EpsilonController` floor |
| `--epsilon-max` | `0.4` | `EpsilonController` ceiling |
| `--max-edges` | `5000` | Graph-size ceiling feeding `EpsilonController`'s size pressure |
| `--fuzzy` | off | Enable `MotifEngine`'s fuzzy/probabilistic matching mode |
| `--min-confidence` | `0.5` | Only used with `--fuzzy` |
| `--shards` | `1` | Use N shards for the graph store + motif cache (`N=1` is the plain path) |
| `--adaptive-calibration` | off | Enable `AdaptiveDecayCalibrator` |
| `--audit-log` | `logs/audit.log` | Where structured audit records are written |
| `--seed` | `42` | RNG seed (synthetic mode) |
| `--max-ticks` | *(none)* | Synthetic mode only: stop after N ticks instead of running until Ctrl+C |

**Output**: live-printed lines for each anomaly/prune/motif-alert/
motif-reset event, plus a periodic metrics snapshot; structured JSON audit
records in `--audit-log`; a final summary on exit (or Ctrl+C).

See `README.md`'s "Running the full pipeline live" for a fuller walkthrough.

---

### `t_gnn.api` (`python -m t_gnn.api`)

`frontend_implementation` branch only. Runs the FastAPI/uvicorn service
`frontend/` talks to — a decoupled, stateless reader that never
constructs `ActiveGraphStore`/`MotifEngine`/`TGNNInferenceEngine` itself,
only reads what a separately-running `run_pipeline.py` process persisted
to Postgres (and Neo4j for forensics/entity-list endpoints). Not a
detection-pipeline tool in its own right — pair it with `run_pipeline`
per the [cookbook task above](#task-turn-on-the-backend-api-and-frontend-dashboard).

**Module**: `t_gnn.api` (`src/t_gnn/api/__main__.py`)
**Prerequisites**: `python scripts/init_postgres.py` run at least once;
`run_pipeline.py` running (with default Postgres persistence, i.e. without
`--no-api-persist`) for there to be any data to read; `docker compose up -d`
for the forensics/entity-list endpoints backed by Neo4j.

```bash
python -m t_gnn.api                    # listens on 127.0.0.1:8000
python -m t_gnn.api --reload           # auto-reload on source changes, local dev only
```

```powershell
python -m t_gnn.api
python -m t_gnn.api --reload
```

| Flag | Default | Meaning |
|---|---|---|
| `--host` | `127.0.0.1` | Bind address |
| `--port` | `8000` | Bind port — must match `frontend/.env.local`'s `VITE_API_BASE_URL` |
| `--reload` | off | Auto-reload on source changes (local dev only) |

**Environment**: besides `.env`'s connection settings, `API_CORS_ORIGINS`
(F17.3) is a comma-separated list of exact origins allowed to call the API
cross-origin. Unset, it defaults to the Vite dev server
(`http://localhost:5173`, `http://127.0.0.1:5173`). Empty means none. `*` is
rejected.

**Output**: standard uvicorn access logs. Sanity-check it's up and has
data with `curl http://127.0.0.1:8000/api/health` and
`curl http://127.0.0.1:8000/api/metrics/snapshot`.

**As a container** (F17.2): `docker compose --profile dashboard up -d
--build` runs this API alongside the dashboard, behind the dashboard's
nginx proxy at `http://localhost:8080`. See
[`docs/deployment.md`](deployment.md).

---

### `init_postgres` (`scripts/init_postgres.py`)

Idempotently creates the local dev Postgres database (`t_gnn_dev`) and,
on this branch, the frontend API layer's tables within it (`users`,
`metrics_snapshots`, `entity_scores`, `motif_completions`, `motif_resets`,
`motif_feedback`, `alert_acknowledgements` — DDL owned by
`t_gnn.api_state.create_api_tables()`). Postgres itself is not part of the
detection pipeline; it's used for persistence needs that don't map to
Neo4j/Redis/Flink's roles (see `CLAUDE.md`'s "Local dev database"
section) — the API layer's read/write bridge to `run_pipeline.py` is
exactly that kind of need.

**Prerequisites**: a reachable local Postgres instance (connection
settings from `.env`).

```bash
python scripts/init_postgres.py
```

No flags.
