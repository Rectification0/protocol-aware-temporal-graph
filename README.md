# t_gnn

Protocol-Aware Asymmetric Decay and Stateful Motif Pruning in CTDGs.
See `functionality.txt` (blueprint), `specs.md` (requirements), `design.md`
(architecture), and `tasks.md` (implementation plan / status).

## Phase 0 layout

- `config/schema/edge.schema.json` -- shared edge data contract (tasks.md 0.2).
- `config/protocols.yaml` -- protocol set + placeholder decay constants (0.3).
- `src/t_gnn/schema.py` -- `Edge` dataclass implementing the contract.
- `src/t_gnn/protocol_registry.py` -- loader for `config/protocols.yaml`.
- `src/t_gnn/ingestion/sysmon_adapter.py` -- Sysmon/Security event -> typed edge (0.5).
- `src/t_gnn/data/stage_lanl.py` -- LANL dataset staging pipeline (0.4); see `data/lanl/README.md`.
- `docker-compose.yml` -- target dev infra (Flink, Redis, Neo4j) -- **not currently used**, see below.

## Local dev database

Local development is currently pointed at a Postgres instance the developer
already runs locally (`localhost:5432`) instead of standing up
`docker-compose.yml`. Postgres is a stand-in for whatever a given task
would otherwise persist to -- tables are created only as specific tasks
need them (e.g. Phase 4 cold storage), not preemptively.

Setup:

```bash
cp .env.example .env       # then edit .env with your local credentials
pip install -e ".[dev]"
python scripts/init_postgres.py   # idempotent: creates the t_gnn_dev database if missing
```

`t_gnn.db.get_connection()` reads connection settings from the environment
(`.env` is auto-loaded; real credentials are never committed -- `.env` is
gitignored, only `.env.example` with placeholders is tracked).

Once Flink/Redis/Neo4j-backed phases are actually implemented, bring up
`docker-compose.yml` instead (`docker compose up -d`) and migrate off Postgres.

## Running tests

```bash
pip install -e ".[dev]"
pytest
```
