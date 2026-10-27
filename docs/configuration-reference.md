# Configuration Reference

Everything in this system that's configurable, where it lives, and what
each field means. See `tasks.md` §7.1. For *how* to use these in practice
(tuning workflows, step-by-step procedures), see
[`operational-runbook.md`](operational-runbook.md).

## Protocol decay constants (`config/protocols.yaml`)

Loaded by `src/t_gnn/protocol_registry.py`'s `ProtocolDecayRegistry`
(tasks.md 0.3/1.1/1.2). `w(e,t) = w_0 * e^(-lambda_p * (t - t_e))`
(specs.md FR1.1) — `lambda_p` is the decay constant selected by an edge's
`protocol` field.

```yaml
default_lambda_p: 0.0000198   # used when an edge's protocol isn't found below

protocols:
  RDP:
    lambda_p: 0.0001925       # required: the decay constant itself
    half_life_hours: 1        # optional: human-readable sanity check only --
                               # NOT read by the loader, derive it as ln(2)/lambda_p
    description: "..."        # optional: free text
```

| Field | Required | Meaning |
|---|---|---|
| `default_lambda_p` | yes (top-level) | Fallback `lambda_p` for any protocol not listed under `protocols` |
| `protocols.<NAME>.lambda_p` | yes | The decay constant, in `1/seconds` |
| `protocols.<NAME>.half_life_hours` | no | Documentation only, not consumed by code — keep it in sync with `lambda_p` by hand (`half_life_hours = ln(2) / lambda_p / 3600`) |
| `protocols.<NAME>.description` | no | Free text |

Current values (task 0.3's expert defaults — see task 1.7 for the
calibration mechanism that's meant to refine them):

| Protocol | `lambda_p` | Half-life | Rationale |
|---|---|---|---|
| RDP | 0.0001925 | ~1h | Interactive remote sessions are short-lived |
| Kerberos | 0.0000192 | ~10h | Bounded by typical ticket lifetime |
| SMB | 0.0000040 | ~48h | File shares/mounts routinely stay open for a work-day or two |
| DNS | 0.0000010 | ~192h (8d) | Ambient background traffic, low individual signal |

**Hot-reload:** call `ProtocolDecayRegistry.reload()` (or construct a new
one against the same `config_path`) to re-read the file from disk without
restarting anything — no code change or redeploy needed to correct a value
(FR1.3). `DecayEngine` and `MotifStep`'s structural matching don't cache
`lambda_p`; every `weight_at()` call queries the registry live.
`scripts/run_pipeline.py` does this automatically when the file changes
(`ConfigFileWatcher`, `--config-reload-interval`).

**Dashboard edits** (`frontend_implementation` branch, FB.1,
`src/t_gnn/config_writer.py`): when the API runs with
`API_CONFIG_WRITES_ENABLED=true`, Settings can change a protocol's
`lambda_p` (entered as a half-life) or a motif's `window_seconds`. The
writer edits only that value's line and rewrites `half_life_hours` to
match, so the derived figure never goes stale. It keeps all comments and
appends a `set via dashboard by <analyst>, <time> (was <old>)` note. It
then re-parses the result and refuses the write if anything else would
change. Accepted ranges are a **half-life from 1 minute to 365 days** and a
**window from 60 s to 30 days**. These are sanity rails against certain
mistakes, not tuning advice.

## ε (epsilon) tuning — `EpsilonController` (`src/t_gnn/pruning.py`)

Constructed wherever `PruningWatcher` is constructed — there's no
standalone config file for this; it's Python constructor arguments (tasks.md
2.3, specs.md FR2.2/FR2.3, NFR3):

| Parameter | Required | Meaning |
|---|---|---|
| `epsilon_min` | yes | ε when there's no memory or size pressure (conservative pruning) |
| `epsilon_max` | yes | ε at 100% memory or size pressure (aggressive pruning); must be `>= epsilon_min` |
| `low_watermark` | no (default 70.0) | System memory % below which memory pressure is 0 |
| `high_watermark` | no (default 90.0) | System memory % at/above which memory pressure is 1.0; must be `> low_watermark` |
| `max_edges` | no (default `None`, i.e. no size-pressure signal) | Active Graph Store edge-count ceiling; size pressure = `min(1, edge_count / max_edges)` |
| `backpressure_low` | no (default 0.1) | Flink backpressure ratio at or below which backpressure adds no pressure (Flink's own "ok" band) |
| `backpressure_high` | no (default 0.5) | Ratio at or above which backpressure is full pressure (Flink calls > 0.5 "high"); must be `> backpressure_low` |

`compute_epsilon()` takes the *max* of the memory-pressure, size-pressure and
backpressure signals, then linearly interpolates between
`epsilon_min`/`epsilon_max`.

**Backpressure (Backlog B.2)** is design.md §5's mitigation for "Flink
backpressure during log spikes": prune harder while ingestion can't keep up.
The reading comes from `PruningWatcher(backpressure_probe=...)`, which is any
callable returning a 0-1 ratio or `None`. The shipped probe is
`t_gnn.flink.backpressure.FlinkBackpressureProbe(flink_url, job_name)`. It
reads `GET /jobs/:jid/vertices/:vid/backpressure` from the Flink REST API and
takes the highest subtask `ratio` across every operator: the share of each
second spent blocked on a full downstream buffer. One stalled operator is
enough to back up the source.
- `None` (Flink unreachable, job not running, no sample yet) means no
  pressure, never an error. The probe logs once when it loses Flink and once
  when it gets it back, like `MotifEngine`'s Redis handling.
- Each pass costs one request per operator (four for the shipped job). The
  job/operator lookup is cached for `vertex_cache_seconds` (default 30) and
  redone after any failure, so a resubmitted job is picked up.
- Flink refreshes these numbers from its metrics roughly every 10s, so ε
  responds to a spike within seconds, not instantly.
- `scripts/run_pipeline.py --decay-backend flink` wires the probe in by
  default (`--ignore-backpressure` turns it off) and prints
  `flink_backpressure=` in each metrics line. The in-process backend has
  no Flink job, so it has no backpressure signal.
Tuning guidance:
- Set `max_edges` to whatever RAM budget you've sized the Active Graph
  Store for (design.md §6's open sizing question) — this is the only hard
  ceiling NFR3 actually guarantees, independent of memory-pressure
  accuracy.
- Widen the `epsilon_min`–`epsilon_max` range for more aggressive
  responsiveness to pressure; narrow it if pruning is too "twitchy" under
  normal load swings.
- `PruningWatcher(poll_interval=...)` (default `1.0` seconds) controls how
  often `run_once()` re-evaluates ε and re-scans the store.

## Motif definitions (`config/motifs.yaml` + `config/schema/motif.schema.json`)

Loaded by `src/t_gnn/motifs.py`'s `MotifRegistry` (tasks.md 3.1/3.9,
specs.md FR3.1/FR3.5). Each top-level key under `motifs:` is one motif
name; its body must validate against `config/schema/motif.schema.json`.

```yaml
motifs:
  <motif_name>:
    description: "..."          # optional, free text
    window_seconds: 14400        # required: completion time bound (FR3.1's "~4 hours" example)
    steps:                       # required: ordered list, >= 1 entries
      - edge_type: Authentication          # optional (default: any) -- string or list of strings
        protocol: [RDP, Kerberos]           # optional (default: any) -- string or list
        src_type: Machine                   # optional (default: any): User | Machine
        dst_type: Machine                   # optional (default: any): User | Machine
        key_field: dst                      # required: src | dst
        key_resolver: identity              # optional (default: identity): identity | host_admin
```

| Field | Meaning |
|---|---|
| `window_seconds` | Motif resets if the gap between its first and final matched edge exceeds this |
| `steps[].edge_type` / `protocol` / `src_type` / `dst_type` | Structural filter for that step; omit for "match anything" |
| `steps[].key_field` | Which endpoint (`src` or `dst`) of a matching edge carries the entity-chain key: at step 0 this endpoint's raw id *becomes* the chain key; at later steps this endpoint must *resolve* (via `key_resolver`) to the existing chain key |
| `steps[].key_resolver` | `identity`: the endpoint id must literally equal the chain key (the same entity reappears across hops). `host_admin`: the endpoint (a `User`) is treated as the admin/service account of the chain key (a `Machine`) via a naming-convention heuristic — see `src/t_gnn/motifs.py`'s `HostAdminKeyResolver` docstring for exactly what it matches and its documented limitations |

**Adding a motif expressible with the existing resolvers:** add an entry to
`config/motifs.yaml`, call `MotifRegistry.reload()` — no code change or
redeploy (FR3.5). **Adding a motif that needs new entity-linkage logic
`identity`/`host_admin` can't express:** implement a new `KeyResolver` in
`motifs.py` and register it in `KEY_RESOLVERS`, then reference its name
from `key_resolver` in config — see `operational-runbook.md`.

The two seed motifs (`admin_share_escalation`, `lateral_pivot`) ship in
`config/motifs.yaml` as FR3.1's calibration examples, not an exhaustive
catalog (see tasks.md's Backlog item on the full motif library).

## Neo4j connection (`src/t_gnn/cold_storage.py`'s `Neo4jConfig`)

```python
@dataclass
class Neo4jConfig:
    uri: str = "bolt://localhost:7687"
    user: str = "neo4j"
    password: str = "devpassword123"
    database: Optional[str] = None
```

Defaults match `docker-compose.yml`'s dev credentials. `.env.example`
documents the equivalent `NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD`
variables for reference, though `Neo4jConfig` itself is constructed
explicitly by callers (`Neo4jColdStorageWriter(Neo4jConfig(...))`,
`Neo4jForensicQueryAPI(Neo4jConfig(...))`) rather than reading the
environment automatically — pass your own `Neo4jConfig` for anything other
than local dev.

## Redis connection

No `RedisConfig` dataclass exists — `RedisMotifStateStore(client)` takes an
already-constructed `redis.Redis` client directly (e.g.
`redis.Redis(host="localhost", port=6379, db=0)`, matching
`docker-compose.yml`'s unauthenticated dev instance). Construct your own
client with TLS/auth for anything beyond local dev.

## Flink decay/baseline job (`src/t_gnn/flink/decay_job.py`, Backlog B.1)

The job runs only inside the `t-gnn-flink` containers. Its flags go after
`--` on `scripts/submit_flink_job.py` (for example
`python scripts/submit_flink_job.py --replace -- --refresh-interval 600`):

| Flag | Default | Meaning |
|---|---|---|
| `--bootstrap-servers` | `kafka:29092` | Kafka as the containers see it (compose's `INTERNAL` listener) |
| `--job-name` | `t-gnn-decay-baseline` | `submit_flink_job.py` and `run_pipeline.py` look for this name |
| `--edges-from` | `latest` | Where a first-ever start (no committed offsets) begins reading the edges topic. Restarts resume from the offsets committed at the last checkpoint |
| `--refresh-interval` | `3600` | Event-time seconds between `w(e,t)` re-evaluations of a live edge (design.md 2.1's timer). `0` turns them off and keeps no per-edge state |
| `--expire-below` | `0.05` | The job stops re-evaluating an edge once `w` falls to this (the default `epsilon_min`). This is **not** pruning: `PruningWatcher` still prunes against its dynamic ε |
| `--out-of-orderness` | `5` | Seconds of edge lateness the watermark allows |
| `--idleness` | `5` | Seconds before the mostly-silent `λ_p` input stops holding back the watermark |
| `--alpha` | `0.3` | EWMA smoothing factor, same as `baseline.DEFAULT_ALPHA` |
| `--parallelism` | `1` | Operator parallelism |
| `--checkpoint-interval` | `10` | Seconds between checkpoints |
| `--execution-mode` | `thread` | PyFlink's Python execution mode. `thread` runs the operators inside the JVM (pemja) and was about 3–4× faster here than `process`, a separate Python worker over gRPC, because keyed-state access dominates (docs/benchmarks.md). |

**Checkpoints** go to the `flink-checkpoints` volume
(`state.checkpoint-storage: filesystem` in `docker-compose.yml`'s
`FLINK_PROPERTIES`). Flink's default keeps them in jobmanager memory,
capped at 5 MB. The decay operator holds every edge it is still
re-evaluating (~200 bytes each), so past ~25k live edges that default
failed every checkpoint and the job crash-looped.

**Throughput** on one taskmanager at parallelism 1 is ~600 edges/s
sustained (docs/benchmarks.md). Raise `--parallelism` (and
`taskmanager.numberOfTaskSlots`) for more.

**Kafka topics.** `ensure_topics()` creates every topic with one partition:

| Topic | Direction | Contents |
|---|---|---|
| `t-gnn.edges.raw` | in | `Edge.to_json()`, keyed by `src` |
| `t-gnn.decay.lambdas` | in, compacted | One record per protocol: `{"protocol", "lambda_p", "published_at"}`. Key `*` carries `default_lambda_p` |
| `t-gnn.edges.decayed` | out | `{"edge", "deviation"}`, the same `ProcessedEdge` that `DecayStreamProcessor.process(edge, t=edge.t_e)` returns |
| `t-gnn.edges.weights` | out | Timer re-evaluations: `{"edge_id", "src", "dst", "protocol", "t", "w", "lambda_p", "expired"}` |

**Time.** Event time is each edge's own `t_e`. The decayed output therefore
matches the in-process path exactly (`tests/test_flink_job.py` checks this
against the live job). Re-evaluation timers advance with the data, not the
wall clock, so they stop firing when edges stop arriving.

**Before any `λ_p` is published,** an edge is held in state and retried
every second rather than decayed with a guessed constant.
`submit_flink_job.py` and `run_pipeline.py --decay-backend flink` both
publish `config/protocols.yaml` on start.

## `BufferedColdStorageWriter` (`src/t_gnn/cold_storage.py`, tasks.md 6.4)

| Parameter | Default | Meaning |
|---|---|---|
| `writer` | required | The real `ColdStorageWriter` to drain into (e.g. `Neo4jColdStorageWriter`) |
| `max_queue_size` | 10,000 | Backpressure ceiling — `write()` raises `queue.Full` once reached, which `PruningWatcher` already treats as "leave the edge active, retry next pass" |
| `max_retries` | 3 | Attempts per record before it's logged as permanently dropped (`self.dropped` counter) |
| `retry_backoff` | 1.0s | Sleep between retry attempts, on the drain thread only |

## `MetricsCollector` (`src/t_gnn/metrics.py`, tasks.md 6.2)

| Parameter | Default | Meaning |
|---|---|---|
| `store` | required | The `ActiveGraphStore` to read live size from |
| `window_seconds` | 60.0 | Trailing window for all three `RollingRateCounter`s (prune/motif-hit/motif-reset rate) |
| `prune_bus` / `alert_bus` / `reset_bus` | `None` | Optional buses to auto-subscribe to; omit whichever you don't want tracked |
| `max_history` | 1000 | Cap on `epsilon_history`/`inference_latency_history` length (oldest entries drop first) |

## `AuditLogger` (`src/t_gnn/audit.py`, tasks.md 6.1)

| Parameter | Default | Meaning |
|---|---|---|
| `sink` | required | `FileAuditSink(path)` for a real newline-delimited JSON log file, or `InMemoryAuditSink()` for tests |
| `prune_bus` / `reset_bus` | `None` | Optional buses to auto-subscribe to |

## T-GNN model (`src/t_gnn/tgnn.py`, tasks.md 5.1/5.2)

| Parameter | Default | Meaning |
|---|---|---|
| `DynamicTGNN(base_feature_dim, hidden_dim)` | 8, 16 | Per-entity embedding width and hidden layer width of the two `SAGEConv` layers |
| `TGNNInferenceEngine(store, model, result_bus, alert_bus, poll_interval)` | — , `DynamicTGNN()`, `InferenceResultBus()`, `None`, 1.0s | `alert_bus`, if given, auto-subscribes `on_motif_completion` as the fast-path trigger (5.3); `poll_interval` controls the background scheduled-inference loop's cadence |

Per specs.md §4's non-goal, this model's architecture is intentionally
minimal (untrained/randomly initialized) — these parameters tune the
*integration*, not detection accuracy. See `docs/operational-runbook.md`
if you're swapping in a trained model.

## Synthetic traffic simulator (`src/t_gnn/data/simulate_traffic.py`, extends tasks.md 7.3)

CLI flags for `python -m t_gnn.data.simulate_traffic`:

| Flag | Default | Meaning |
|---|---|---|
| `--output-dir` | required | Writes `<dir>/staged/` (NDJSON shards) and `<dir>/redteam.txt` |
| `--num-users` / `--num-machines` | 200 / 50 | Size of the synthetic population |
| `--days` | 7.0 | Duration of the simulated traffic window |
| `--events-per-user-per-day` | 3.0 | Background authentication volume per user |
| `--num-lateral-pivots` / `--num-admin-share-escalations` | 3 / 3 | Injected instances of each seed motif |
| `--num-anomalies` | 3 | Injected "low and slow" anomalies (FR1.5 z-score target) |
| `--epoch-start` | matches `stage_lanl.py`'s `DEFAULT_EPOCH_START` | Anchors the simulated relative timeline to a real epoch |
| `--shard-size` | matches `stage_lanl.py`'s `DEFAULT_SHARD_SIZE` | Output NDJSON shard size |
| `--seed` | 42 | Same seed always reproduces identical traffic |

See `docs/operational-runbook.md`'s "Generating simulated traffic for
testing" for the intended workflow (feed the output straight into
`pilot.py`).

## Environment variables (`.env.example`)

| Variable | Used by |
|---|---|
| `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD` | `src/t_gnn/db.py` (Postgres, for persistence needs that don't map to Flink/Redis/Neo4j — see `CLAUDE.md`'s "Local dev database" section) |
| `PGTEST_DATABASE` | `src/t_gnn/db.py` (Backlog B.9): the database the Postgres-backed tests write to and wipe, default `t_gnn_test`. Must end in `_test` and differ from `PGDATABASE`, or the tests refuse to run against it |
| `KAFKA_BOOTSTRAP_SERVERS` | `src/t_gnn/flink/kafka_io.py` (Backlog B.1), default `localhost:9092` |
| `FLINK_REST_URL` | `src/t_gnn/flink/harness.py` and `tests/test_flink_job.py`: the Flink REST API the test harness and benchmark talk to, default `http://localhost:8081`. Set it, together with `KAFKA_BOOTSTRAP_SERVERS=kafka:29092`, to `http://jobmanager:8081` when the Flink tests run in a container on the compose network |
| `NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD` | Documented reference values matching `docker-compose.yml`; not auto-read by `Neo4jConfig` (construct it explicitly) |
| `AUDIT_LOG_PATH` | `frontend_implementation` branch only — `src/t_gnn/api/deps.py`'s `audit_log_path()` (tasks.md F0.8), default `logs/audit.log`, must match whatever `scripts/run_pipeline.py --audit-log` path the pipeline process is writing to |
| `STREAM_POLL_INTERVAL_SECONDS` | `frontend_implementation` branch only — `src/t_gnn/api/deps.py`'s `get_stream_config()` (tasks.md F0.10's SSE endpoint), default `1.0` |
| `PILOT_REPORT_PATH` | `frontend_implementation` branch only — `src/t_gnn/api/deps.py`'s `pilot_report_path()` (tasks.md F8.4's `GET /api/pilot/latest-report`), default `pilot-report.json`, must match whatever path `pilot.py --output` was pointed at |

Copy `.env.example` to `.env` and edit it for your local credentials —
`.env` is gitignored and auto-loaded by `t_gnn/db.py`.
