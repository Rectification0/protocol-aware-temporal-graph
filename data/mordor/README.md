# Mordor / OTRF Security-Datasets — Staging (tasks.md Backlog B.8)

[OTRF/Security-Datasets](https://github.com/OTRF/Security-Datasets)
(formerly "Mordor") is a public collection of *real* Sysmon + Windows
Security event captures of actual attack techniques -- lateral movement,
credential access, persistence, etc. -- mapped to the MITRE ATT&CK
framework. Unlike `src/t_gnn/data/simulate_traffic.py`'s synthetic
generator, replaying one of these gives you real recorded attacker
behavior instead of an invented one.

## Why this dataset needed only a small bridging layer, not a new adapter

Mordor datasets are shipped as Winlogbeat-style newline-delimited JSON --
one flattened Windows Event Log record per line. That is exactly the
"already normalized to a flat dict... as most log shippers (Winlogbeat,
NXLog) produce" input `src/t_gnn/ingestion/sysmon_adapter.py` (task 0.5)
already expects. Confirmed against a real downloaded sample
(`purplesharp_ad_playbook_I`, a lateral-movement capture) rather than
assumed: every field the adapter's handlers read (`TargetUserName`,
`LogonType`, `AuthenticationPackageName`, `SubjectUserName`, `User`,
`ParentImage`, `DestinationHostname`/`DestinationIp`/`DestinationPort`,
`TargetFilename`) matches Mordor's raw field names one-for-one, since both
trace back to the same underlying Windows Event Log XML `EventData`
fields. Only two fields needed bridging, both handled by
`src/t_gnn/data/stage_mordor.py`'s `normalize()`:

- Mordor's `Hostname` (e.g. `"MORDORDC.theshire.local"`) -> the adapter's
  `Computer`.
- Mordor's `@timestamp` (ISO 8601 UTC, e.g.
  `"2020-10-22T08:29:48.785Z"`, added by Winlogbeat) -> the adapter's
  `TimeCreated` (epoch seconds float).

A real capture also contains thousands of event types this adapter has no
mapping for (image loads, registry events, DNS queries, ...) --
`stage_mordor.py` tracks those separately (`lines_unsupported`) rather
than treating them as a staging failure.

**Observed data quirk**: some Sysmon EventID 3 (NetworkConnect) records
have `DestinationHostname` set to the literal string `"-"` (Sysmon's
"couldn't resolve" placeholder) rather than being absent -- since
`sysmon_adapter.py`'s `_handle_network_connect()` only falls back to
`DestinationIp` when `DestinationHostname` is falsy/missing, these produce
an edge with `dst="Machine:-"` rather than a resolved hostname. This is an
existing `sysmon_adapter.py` heuristic limitation surfaced by real data,
not something `stage_mordor.py` introduces or works around.

## Acquiring a dataset

1. Browse `https://github.com/OTRF/Security-Datasets/tree/master/datasets`
   (organized by `atomic`/`large`/`small` scale, then OS, then MITRE
   ATT&CK tactic, e.g. `atomic/windows/lateral_movement/host/`). Pick a
   `.zip` (most datasets) or `.json` file and download it.
2. Stage it -- `stage()` reads a `.zip` (extracting its one `.json`
   member) or a raw `.json` directly, no manual unzip needed:

   ```bash
   python -m t_gnn.data.stage_mordor \
       --input empire_psexec_dcerpc_tcp_svcctl.zip \
       --output data/mordor/staged
   ```

3. Feed the staged shards into any of the existing downstream tools the
   same way LANL/simulated shards already work:

   ```bash
   python -m t_gnn.score_entities --staged-dir data/mordor/staged --top 10
   ```

   Or watch it flow through the live continuous pipeline (real Neo4j/Redis,
   prune events, motif alerts, and metrics printed as they happen) via
   `scripts/run_pipeline.py --source replay`:

   ```bash
   docker compose up -d
   python scripts/run_pipeline.py --source replay --staged-dir data/mordor/staged
   ```

   There's no `redteam.txt`-format ground truth for Mordor captures (the
   whole capture *is* the labeled attack technique, by construction, not a
   mix of benign + injected malicious activity the way LANL/simulated
   traffic is) -- `pilot.py`'s false-positive/negative evaluation doesn't
   apply here the same way; use `score_entities.py`, `run_pipeline.py`, or
   the forensic/motif tooling directly to inspect what the pipeline does
   with real attacker telemetry.

## Local dev fixture

`data/mordor/raw/sample_mordor.json` is a tiny **hand-constructed**
fixture in the real schema described above (not an excerpt of any actual
Mordor capture) -- one record per event type this adapter maps
(4624/4769/5140/Sysmon-1/3/11), plus one unsupported event type (Sysmon
EventID 22, DNS query) and one incomplete/malformed line, so
`tests/test_stage_mordor.py` can exercise every code path without a real
dataset present. Same "tiny synthetic fixture, not a substitute for real
data" disclaimer `data/lanl/README.md` makes about its own fixture.
