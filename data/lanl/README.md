# LANL Comprehensive Cybersecurity Dataset — Staging (tasks.md 0.4)

Used for offline replay/calibration per specs.md FR5.4 and design.md §2.9
("Offline validation adapter"): deriving initial `lambda_p` values (task 1.7)
and, via `src/t_gnn/pilot.py`'s pilot-evaluation harness (task 7.3),
validating detection against labeled red-team activity before production
deployment.

## Acquiring the raw data

The dataset is published by Los Alamos National Laboratory at
https://csr.lanl.gov/data/cyber1/ . It is not vendored in this repo (multi-GB,
external distribution). To stage it locally:

1. Download `auth.txt.gz` (and optionally `redteam.txt.gz` for labeled
   ground truth) from the LANL site above into `data/lanl/raw/`.
2. Run the staging script (`stage_lanl.py`) to convert it into the shared
   edge schema (`config/schema/edge.schema.json`) and shard it for replay.

```bash
python -m t_gnn.data.stage_lanl \
    --input data/lanl/raw/auth.txt.gz \
    --output data/lanl/staged
```

`redteam.txt.gz` (ground-truth compromise labels) is not consumed by the
staging step; it is joined in by `src/t_gnn/pilot.py`'s pilot-evaluation
harness (task 7.3), which parses it via `load_redteam_labels()` and compares
each label's `t`/entity against the staged replay's deviation signals and
motif completions to compute false-positive/negative rates.

## Raw format (`auth.txt.gz`)

Comma-separated, no header, one authentication event per line:

```
time,source_user@domain,destination_user@domain,source_computer,destination_computer,authentication_type,logon_type,authentication_orientation,success/failure
```

`time` is an integer count of seconds since the start of the capture window
(not a real epoch timestamp) — the staging script treats it as a relative
offset and exposes an `--epoch-start` flag to anchor it to a real epoch time
for replay pacing.

## Staged output

`stage_lanl.py` writes newline-delimited JSON shards under `data/lanl/staged/`,
each line a serialized `t_gnn.schema.Edge` (`edge_type="Authentication"`,
`protocol` inferred from `authentication_type`/`logon_type` — see
`PROTOCOL_INFERENCE` in `stage_lanl.py`). These shards are what the replay
adapter (design.md §2.9) feeds into the Flink pipeline in "replay mode".

## Local dev fixture

`data/lanl/raw/sample_auth.txt.gz` is a tiny synthetic fixture (same column
format, fabricated values) used by `tests/test_stage_lanl.py` so the staging
pipeline is testable without the real multi-GB dataset present.

`data/lanl/raw/sample_redteam.txt` is the matching tiny synthetic
`redteam.txt` fixture (same `time,user@domain,source_computer,
destination_computer` format as the real ground truth), labeling one of
`sample_auth.txt.gz`'s rows as malicious. `tests/test_pilot.py` uses it to
exercise `src/t_gnn/pilot.py`'s evaluation harness end-to-end -- a smoke
test of the mechanism, not a validated detection result (the fixture is
too small for either seed motif to structurally match, and its one labeled
entity has no prior baseline history for a z-score at all).

## Need more than the tiny fixture, but don't have real data yet?

`src/t_gnn/data/simulate_traffic.py` (`python -m t_gnn.data.simulate_traffic`)
generates synthetic traffic + `redteam.txt`-format labels at whatever
scale you configure, with verifiably-detectable injected instances of both
seed motifs and a low-and-slow anomaly -- see
`docs/operational-runbook.md`'s "Generating simulated traffic for testing".
It writes staged NDJSON directly (no `auth.txt` round-trip needed) rather
than extending this directory's raw/staged split. Still synthetic, not a
substitute for the real dataset or a real pilot.
