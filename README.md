# t_gnn

Protocol-Aware Asymmetric Decay and Stateful Motif Pruning in CTDGs: a
real-time threat-detection system design for enterprise networks, built on
Temporal GNNs over Continuous-Time Dynamic Graphs.

See `functionality.txt` (blueprint), `specs.md` (requirements), `design.md`
(architecture), and `tasks.md` (implementation plan / status) for the full
design. `CLAUDE.md` has the detailed module-by-module architecture notes.

## Status

Phases 0-6 are implemented: Foundations (edge/protocol schema + ingestion
adapters), Protocol-Aware Time-Decay (FR1), Dynamic Graph Pruning (FR2),
Stateful Motif Caching (FR3), Cold Storage & Forensics (FR4), T-GNN
Integration, and Observability & Hardening. See `tasks.md` for the
per-task checklist.

- `config/schema/edge.schema.json`, `config/schema/motif.schema.json` -- the edge and motif definition contracts.
- `config/protocols.yaml`, `config/motifs.yaml` -- protocol decay constants and the seed motif library.
- `src/t_gnn/schema.py`, `src/t_gnn/protocol_registry.py` -- the `Edge` contract and its decay-constant registry.
- `src/t_gnn/decay.py`, `src/t_gnn/baseline.py`, `src/t_gnn/streaming.py`, `src/t_gnn/data/calibrate_decay.py` -- Phase 1: per-protocol decay, EWMA baseline/deviation, and LANL-based calibration.
- `src/t_gnn/graph_store.py`, `src/t_gnn/pruning.py`, `src/t_gnn/cold_storage.py` -- Phase 2: the Active Graph Store, the Pruning Watcher, and the Neo4j cold-storage write path (plus Phase 6's `BufferedColdStorageWriter`).
- `src/t_gnn/motifs.py`, `src/t_gnn/motif_engine.py` -- Phase 3: motif definitions and the Redis-backed delta-update/reset-on-prune engine (plus Phase 6's Redis-outage graceful degradation and `MotifResetEvent`/`MotifResetBus`).
- `src/t_gnn/forensics.py` -- Phase 4: the forensic query API over Phase 2's Neo4j cold storage ("reconstruct activity around entity X in time window Y", point lookup by edge id).
- `src/t_gnn/tgnn.py` -- Phase 5: the PyTorch Geometric forward pass over the live Active Graph Store, with the FR1.5 deviation signal wired in as an input feature and motif completions (FR3.4) as a fast-path inference trigger.
- `src/t_gnn/audit.py`, `src/t_gnn/metrics.py` -- Phase 6: NFR5 audit logging for prune/motif-reset events, and a metrics collector for active graph size, prune/motif-hit/motif-reset rates, epsilon history, and inference latency.
- `src/t_gnn/ingestion/sysmon_adapter.py`, `src/t_gnn/data/stage_lanl.py` -- the two reference ingestion adapters (Sysmon and offline LANL replay).

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

## Running tests

```bash
pip install -e ".[dev]"
pytest
```

Tests that need the live Neo4j or Redis instance `skip` (rather than fail)
if `docker compose up -d` hasn't been run.
