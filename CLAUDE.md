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

Only Phase 0 (Foundations) is implemented so far. Later phases (Flink decay
pipeline, pruning watcher, Redis motif engine, Neo4j cold storage, T-GNN
integration) do not have code yet — `docker-compose.yml` describes the target
stack for them but isn't the current dev backend (see below).

## Commands

```bash
pip install -e ".[dev]"                 # install package + pytest
pytest                                   # run full test suite
pytest tests/test_schema.py              # run one test file
pytest tests/test_schema.py::test_round_trip_json   # run one test
python scripts/init_postgres.py          # idempotent: create the t_gnn_dev database
python -m t_gnn.data.stage_lanl --input <auth.txt.gz> --output <dir>   # stage LANL dataset
```

There is no lint/format/build step configured yet.

## Local dev database — read before adding any persistence code

Local development currently targets a Postgres instance the developer runs
locally (`localhost:5432`, database `t_gnn_dev`) via `src/t_gnn/db.py`
(`get_connection()`), **not** the `docker-compose.yml` stack (Flink/Redis/Neo4j).
This is a deliberate temporary redirect, not the target architecture in
`design.md`. Default any new persistence work to Postgres through
`t_gnn/db.py` and create tables only when a task actually needs them, rather
than pre-building schema for later phases. Bring up `docker-compose.yml`
instead once a phase genuinely needs Flink/Redis/Neo4j semantics.

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

**Two ingestion adapters both produce `Edge` instances**, and are meant to be
interchangeable inputs to the same downstream pipeline (design.md §2.9):

- `src/t_gnn/ingestion/sysmon_adapter.py` (`SysmonEventAdapter.parse()`) — takes a normalized Windows Security/Sysmon event dict (flat, already parsed from XML by whatever log shipper) and dispatches on `(Channel, EventID)` to a handler. Deliberately combines two event families to reconstruct the two hops of the canonical lateral-movement motif from specs.md §1.1: Sysmon EventID 3 (NetworkConnect) yields the `Machine -> Machine` first hop, while Security logon events and Sysmon EventID 1 (ProcessCreate) yield the `User -> Machine` second hop. Protocol inference per event type is a documented heuristic (port number for NetworkConnect, LogonType/AuthenticationPackageName for logons, parent-process name for RCE) expected to be refined once real telemetry/calibration data is available.
- `src/t_gnn/data/stage_lanl.py` (`stage()`) — converts the LANL Comprehensive Cybersecurity dataset's `auth.txt.gz` (relative-time CSV, documented in `data/lanl/README.md`) into sharded NDJSON of the same `Edge` shape, anchoring the dataset's relative timestamps to a real epoch via `--epoch-start`. The real multi-GB dataset isn't vendored; `data/lanl/raw/sample_auth.txt.gz` is a tiny synthetic fixture in the same column format for tests.

When adding a third ingestion source, follow this same pattern: parse into
`Edge` instances via `schema.py`, don't invent a parallel edge representation.
