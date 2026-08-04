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

`compute_epsilon()` takes the *max* of the memory-pressure and size-pressure
signals, then linearly interpolates between `epsilon_min`/`epsilon_max`.
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
| `NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD` | Documented reference values matching `docker-compose.yml`; not auto-read by `Neo4jConfig` (construct it explicitly) |
| `AUDIT_LOG_PATH` | `frontend_implementation` branch only — `src/t_gnn/api/deps.py`'s `audit_log_path()` (tasks.md F0.8), default `logs/audit.log`, must match whatever `scripts/run_pipeline.py --audit-log` path the pipeline process is writing to |
| `STREAM_POLL_INTERVAL_SECONDS` | `frontend_implementation` branch only — `src/t_gnn/api/deps.py`'s `get_stream_config()` (tasks.md F0.10's SSE endpoint), default `1.0` |

Copy `.env.example` to `.env` and edit it for your local credentials —
`.env` is gitignored and auto-loaded by `t_gnn/db.py`.
