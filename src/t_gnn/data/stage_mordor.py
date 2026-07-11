"""Stage OTRF/Security-Datasets ("Mordor") captures for offline replay (tasks.md Backlog B.8).

Mordor datasets (https://github.com/OTRF/Security-Datasets) are real
Sysmon + Windows Security event captures of actual attack techniques
(lateral movement, credential access, etc., mapped to MITRE ATT&CK),
shipped as Winlogbeat-style newline-delimited JSON -- one flattened
Windows Event Log record per line. That is exactly the "already
normalized to a flat dict... as most log shippers (Winlogbeat, NXLog)
produce" input `src/t_gnn/ingestion/sysmon_adapter.py`'s own docstring
already expects (task 0.5) -- confirmed against a real downloaded sample
(`purplesharp_ad_playbook_I`, a lateral-movement capture) rather than
assumed. Only two fields need bridging before `SysmonEventAdapter.parse()`
can consume a raw Mordor record directly:

  - Mordor's `Hostname` field (e.g. "MORDORDC.theshire.local") -> the
    adapter's `Computer` field.
  - Mordor's `@timestamp` (ISO 8601 UTC string, added by Winlogbeat, e.g.
    "2020-10-22T08:29:48.785Z") -> the adapter's `TimeCreated` (epoch
    seconds float).

Every other field the adapter's handlers read (`TargetUserName`,
`LogonType`, `AuthenticationPackageName`, `SubjectUserName`, `User`,
`ParentImage`, `DestinationHostname`/`DestinationIp`/`DestinationPort`,
`TargetFilename`) already matches Mordor's raw field names one-for-one,
since both trace back to the same underlying Windows Event Log XML
`EventData` fields -- confirmed field-by-field against real
4624/4625/4769/5140/5145/Sysmon-1/3/11 records, not assumed.

A real Mordor capture also contains thousands of event types this adapter
has no mapping for (image loads, registry events, DNS queries, ...) --
`SysmonEventAdapter.parse()` raises `UnsupportedEventError` for those, and
`stage()` tracks them separately (`lines_unsupported`) rather than treating
them as a staging failure; only actually-malformed lines or recognized-but-
incomplete events count as `lines_skipped`.

Datasets are distributed as `.zip` archives containing one `.json` file
(a few are un-zipped `.json` directly); `stage()` accepts either.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterator, Optional

from t_gnn.ingestion.sysmon_adapter import SysmonEventAdapter, UnsupportedEventError
from t_gnn.schema import Edge

DEFAULT_SHARD_SIZE = 100_000


def _parse_timestamp(raw: dict) -> Optional[float]:
    """Mordor's `@timestamp` is ISO 8601 UTC, e.g. "2020-10-22T08:29:48.785Z"."""
    value = raw.get("@timestamp")
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def normalize(raw: dict) -> dict:
    """Bridges Mordor's raw Winlogbeat JSON field names onto the flat-dict
    shape `SysmonEventAdapter` expects -- see module docstring for exactly
    which two fields differ; everything else passes through unchanged."""
    normalized = dict(raw)
    if "Computer" not in normalized and "Hostname" in normalized:
        normalized["Computer"] = normalized["Hostname"]
    if "TimeCreated" not in normalized:
        t_e = _parse_timestamp(raw)
        if t_e is not None:
            normalized["TimeCreated"] = t_e
    return normalized


@dataclass
class StagingStats:
    lines_read: int = 0
    edges_written: int = 0
    lines_skipped: int = 0
    lines_unsupported: int = 0
    shards_written: int = 0


def _iter_json_lines(input_path: Path) -> Iterator[str]:
    if input_path.suffix == ".zip":
        with zipfile.ZipFile(input_path) as zf:
            json_names = [n for n in zf.namelist() if n.endswith(".json")]
            if not json_names:
                raise ValueError(f"no .json member found in {input_path}")
            with zf.open(json_names[0]) as fh:
                for raw_line in fh:
                    yield raw_line.decode("utf-8")
    else:
        with open(input_path, "r", encoding="utf-8") as fh:
            yield from fh


def parse_mordor_stream(lines: Iterator[str]) -> Iterator[tuple[Optional[Edge], str]]:
    """Yields `(edge_or_none, status)` per line, `status` in
    `{"ok", "skipped", "unsupported"}`:
      - "unsupported": this event's `(Channel, EventID)` has no mapping in
        `SysmonEventAdapter` at all -- expected for the vast majority of a
        real capture, which records everything on the host, not just the
        subset FR5.2 cares about.
      - "skipped": malformed JSON, or a recognized event type missing a
        required field (`SysmonEventAdapter.parse()` returned `None`).
      - "ok": a real `Edge` was produced.
    """
    adapter = SysmonEventAdapter()
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError:
            yield None, "skipped"
            continue

        try:
            edge = adapter.parse(normalize(raw))
        except UnsupportedEventError:
            yield None, "unsupported"
            continue

        if edge is None:
            yield None, "skipped"
            continue
        yield edge, "ok"


def stage(input_path: Path, output_dir: Path, shard_size: int = DEFAULT_SHARD_SIZE) -> StagingStats:
    output_dir.mkdir(parents=True, exist_ok=True)
    stats = StagingStats()

    shard_idx = 0
    shard_fh = None
    lines_in_shard = 0

    def _open_shard():
        nonlocal shard_fh, lines_in_shard, shard_idx
        shard_path = output_dir / f"shard-{shard_idx:05d}.jsonl"
        shard_fh = open(shard_path, "w", encoding="utf-8")
        lines_in_shard = 0
        stats.shards_written += 1

    _open_shard()
    for edge, status in parse_mordor_stream(_iter_json_lines(input_path)):
        stats.lines_read += 1
        if status == "unsupported":
            stats.lines_unsupported += 1
            continue
        if status == "skipped":
            stats.lines_skipped += 1
            continue
        shard_fh.write(edge.to_json() + "\n")
        stats.edges_written += 1
        lines_in_shard += 1
        if lines_in_shard >= shard_size:
            shard_fh.close()
            shard_idx += 1
            _open_shard()
    if shard_fh:
        shard_fh.close()

    manifest = {
        "source_file": str(input_path),
        "source_sha256": _sha256(input_path),
        "lines_read": stats.lines_read,
        "edges_written": stats.edges_written,
        "lines_skipped": stats.lines_skipped,
        "lines_unsupported": stats.lines_unsupported,
        "shards_written": stats.shards_written,
    }
    with open(output_dir / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    return stats


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="Path to a Mordor .json or .zip dataset file")
    parser.add_argument("--output", required=True, type=Path, help="Directory for staged NDJSON shards")
    parser.add_argument("--shard-size", type=int, default=DEFAULT_SHARD_SIZE)
    args = parser.parse_args()

    stats = stage(args.input, args.output, args.shard_size)
    print(json.dumps(stats.__dict__, indent=2))


if __name__ == "__main__":
    main()
