# LANL Comprehensive Cybersecurity Dataset — Staging (tasks.md 0.4)

Used for offline replay/calibration per specs.md FR5.4 and design.md §2.9
("Offline validation adapter"): deriving initial `lambda_p` values (task 1.7)
and validating motif detection (Phase 3) against labeled red-team activity
before production deployment.

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
staging step; it is joined in during calibration/validation (tasks 1.7, 5.4)
against the `t_e`/entity fields of the staged edges.

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
