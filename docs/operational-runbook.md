# Operational Runbook

Step-by-step procedures for operating this system. See `tasks.md` §7.2. For
field-by-field reference on any config surface mentioned below, see
[`configuration-reference.md`](configuration-reference.md).

## Tuning `λ_p` (decay constants)

1. **Diagnose.** Check `MetricsCollector.snapshot().prune_rate_per_second`
   and `epsilon_history` (tasks.md 6.2) for an abnormal prune rate, and/or
   grep the audit log (see "Monitoring" below) for a burst of `"type":
   "prune"` records concentrated in one `protocol`. design.md §5's
   "Incorrect λ_p" failure-mode row is exactly this symptom.
2. **Derive a corrected value**, either:
   - From expert judgment (protocol behavior — see the rationale table in
     `configuration-reference.md`), or
   - From real traffic: `python -m t_gnn.data.calibrate_decay --staged-dir
     <dir> [--output report.json]` derives a suggested `λ_p` per protocol
     from the median same-entity inter-arrival gap in staged edges (task
     1.7). It only *reports* a suggestion when a protocol clears
     `min_samples`; otherwise it flags `sufficient_data=False` and defers
     to the current registry value — treat a low-sample suggestion as
     informational, not authoritative.
3. **Edit `config/protocols.yaml`** with the corrected `lambda_p` (and
   update `half_life_hours`/`description` for the next person, even though
   they're not machine-read).
4. **Hot-reload, no redeploy** (FR1.3): call `registry.reload()` on the
   running process's `ProtocolDecayRegistry` instance, or restart the
   process if it constructs a fresh one from the same `config_path` on
   startup — either way, no code change.
5. **Verify**: `pytest tests/test_decay.py tests/test_protocol_registry.py`
   still pass, and watch the prune rate/audit log return to baseline over
   the next few minutes.

## Adding a new motif

**Config-driven (no code change, FR3.5) — use this whenever the motif is
expressible as an ordered sequence of typed edge-pattern steps chained by
`identity`/`host_admin`:**

1. Add an entry under `motifs:` in `config/motifs.yaml`, following the
   schema in `configuration-reference.md` (validate mentally against
   `config/schema/motif.schema.json`, or just run the reload step below —
   it validates for you and raises `jsonschema.ValidationError` on a bad
   shape).
2. Call `MotifRegistry.reload()` (or restart the process) — no redeploy.
3. Verify: write a quick test (see `tests/test_motifs.py` for the pattern)
   or run a manual replay through `MotifEngine.on_edge()` with synthetic
   edges matching your new steps, confirming a `MotifCompletionEvent`
   fires when expected and *doesn't* fire on near-misses (wrong protocol,
   wrong order, outside the time window).

**Code-driven — only when the motif needs entity-linkage logic
`identity`/`host_admin` can't express** (e.g. a real directory/asset-
inventory lookup instead of `host_admin`'s naming-convention heuristic):

1. Implement a new class satisfying `motifs.py`'s `KeyResolver` protocol
   (`candidate_key(node_id: str) -> Optional[str]`).
2. Register it in `motifs.py`'s `KEY_RESOLVERS` dict under a new name.
3. Reference that name from `key_resolver` in `config/motifs.yaml` — the
   rest of the pipeline (state store, delta-update, reset-on-prune) needs
   no changes.
4. Add unit tests for the new resolver (mirror
   `test_host_admin_key_resolver_extracts_machine_name_from_admin_account`
   in `tests/test_motifs.py`).

## Investigating forensic queries

Two ways to query Phase 4's cold storage, both reading the same
`(Entity)-[:PRUNED_EDGE]->(Entity)` shape `Neo4jColdStorageWriter` writes:

**Programmatically**, via `src/t_gnn/forensics.py`:

```python
from t_gnn.forensics import Neo4jForensicQueryAPI

with Neo4jForensicQueryAPI() as api:
    # "reconstruct activity around entity X in time window Y" (design.md 2.7)
    records = api.reconstruct_activity("Machine:C1042", start=t0, end=t1)

    # resolve a specific edge id (e.g. from a MotifCompletionEvent.matched_edges)
    record = api.get_edge(edge_id)
```

**Directly in Neo4j Browser** (`http://localhost:7474`), for ad hoc
investigation:

```cypher
// All activity touching an entity, most recent first
MATCH (e:Entity {id: "Machine:C1042"})-[r:PRUNED_EDGE]-(other)
RETURN other.id, r.protocol, r.edge_type, r.t_e, r.pruned_at
ORDER BY r.t_e DESC LIMIT 50;

// Reconstruct a specific edge by id
MATCH (src)-[r:PRUNED_EDGE {edge_id: "..."}]->(dst)
RETURN src.id, dst.id, r;

// Everything pruned in a given time window (audit/tuning use, per NFR5)
MATCH ()-[r:PRUNED_EDGE]-()
WHERE r.pruned_at >= $start AND r.pruned_at <= $end
RETURN r.protocol, count(*) ORDER BY count(*) DESC;
```

`PRUNED_EDGE.t_e` (original event time) and `PRUNED_EDGE.edge_id` are
indexed for the first two patterns; `PRUNED_EDGE.pruned_at` is indexed for
the third.

## Monitoring

- **Metrics**: construct one `MetricsCollector(store, prune_bus=...,
  alert_bus=..., reset_bus=...)` and call `.snapshot(now)` for a
  dashboard-ready read of active graph size, prune rate, current ε,
  motif hit/reset rate, and latest inference latency (tasks.md 6.2). Call
  `.observe_pruning_pass(stats, t)` and `.observe_inference_pass(results,
  latency, t, trigger)` alongside your own `PruningWatcher.run_once()` /
  `TGNNInferenceEngine` calls to populate the two history series.
- **Audit log**: point an `AuditLogger` at a `FileAuditSink(path)` and
  subscribe it to your `PruneEventBus`/`MotifResetBus` instances. Each line
  is a JSON object with a `"type"` of `"prune"` or `"motif_reset"` — grep
  or `jq` it directly:

  ```bash
  jq -c 'select(.type == "prune")' audit.log | wc -l         # prune count
  jq -c 'select(.type == "motif_reset")' audit.log            # all resets
  ```

## Responding to a Redis outage

Motif detection (Phase 3) degrades automatically per tasks.md 6.3 — no
operator action is required to keep the rest of the system running:
`MotifEngine.available` flips to `False` on the first `RedisError`, every
`on_edge()`/`on_prune()` call becomes a safe no-op instead of raising, and
it flips back once Redis is reachable again. FR1.5's anomaly detection
(`BaselineStore`/`DecayEngine`/`TGNNInferenceEngine`) has no Redis
dependency and is unaffected throughout.

What you should still do:
1. Check `motif_engine.available` (or watch for the "motif detection
   degraded" log line) to confirm *when* the outage started and ended.
2. Be aware that any partial motif matches in progress when Redis went
   down are lost (not buffered) — once Redis returns, in-flight attacker
   sequences that started during the outage window won't be detected via
   motifs, only via the (unaffected) anomaly-deviation path. This is the
   accepted tradeoff of "disabled, best-effort" degradation (design.md §5)
   rather than a stronger buffered-replay guarantee.
3. Fix the underlying Redis availability issue — no application-level
   recovery action is needed beyond that.

## Responding to a Neo4j slowdown

If `PruningWatcher`'s `cold_storage` is a `BufferedColdStorageWriter`
(tasks.md 6.4), pruning throughput is already protected — `write()` only
enqueues, so `run_once()` never blocks on Neo4j latency. Operator actions:

1. Watch `buffered_writer.qsize()` — a persistently growing queue means the
   drain rate can't keep up with the prune rate; either Neo4j needs
   attention or `max_queue_size` needs raising as a stopgap.
2. Watch `buffered_writer.dropped` — any nonzero value means records
   exhausted `max_retries` and were permanently lost (logged at `ERROR`).
   This is the accepted tradeoff for 6.4's non-blocking guarantee (see
   `configuration-reference.md`); investigate the underlying Neo4j issue
   before it accumulates further loss.
3. If `cold_storage` is a bare `Neo4jColdStorageWriter` (no buffering),
   `PruningWatcher` itself blocks per-edge on the slow writes — consider
   wrapping it in a `BufferedColdStorageWriter` if this becomes a recurring
   issue.

## Running a pilot evaluation

`src/t_gnn/pilot.py` (tasks.md 7.3) computes false-positive/negative rates
for both detection paths against labeled ground truth:

```bash
python -m t_gnn.pilot \
    --staged-dir data/lanl/staged \
    --redteam data/lanl/raw/redteam.txt \
    --epoch-start 1451606400 \
    [--z-threshold 3.0] [--output pilot-report.json]
```

This replays staged edges through `DecayStreamProcessor`'s baseline path
and the seed motifs from `MotifRegistry`, then reports `true_positives`/
`false_positives`/`false_negatives`/`precision`/`recall` for each path
separately (anomaly-deviation vs. motif-completion).

**What this validates, and what it doesn't:** the harness itself is real
and tested end-to-end (`tests/test_pilot.py`), including against the tiny
synthetic `data/lanl/raw/sample_auth.txt.gz` + `sample_redteam.txt`
fixtures. Running an actual pilot — pointing this at a real subset of
enterprise log traffic with real labeled ground truth, and using the
resulting rates to make a go/no-go rollout call — is the operational step
tasks.md 7.3 asks for and this repo cannot perform: it requires a live
deployment and real labeled data that don't exist here, the same
acquisition gap task 0.4 already documents for the LANL dataset itself.
Before a real pilot: acquire a representative traffic subset + its ground
truth, stage it (`stage_lanl.py` or your production ingestion adapter),
run the command above, and only then decide on full rollout based on the
resulting precision/recall against your organization's acceptable
false-positive/negative thresholds.
