"""Stage the LANL Comprehensive Cybersecurity dataset for offline replay/calibration.

tasks.md 0.4 / specs.md FR5.4 / design.md 2.9.

Converts raw `auth.txt.gz` records (LANL's relative-time CSV format) into the
shared edge schema (config/schema/edge.schema.json) and shards them to
newline-delimited JSON for the replay adapter to feed into the Flink
pipeline at accelerated speed.

Raw column layout (no header)::

    time,source_user@domain,destination_user@domain,source_computer,
    destination_computer,authentication_type,logon_type,
    authentication_orientation,success/failure

`time` is an integer offset in seconds from the start of the capture window,
not a real epoch timestamp -- it is anchored to --epoch-start to produce a
real t_e for the shared schema.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional, TextIO

from t_gnn.schema import Edge

DEFAULT_EPOCH_START = 1_451_606_400  # 2016-01-01T00:00:00Z, arbitrary anchor
DEFAULT_SHARD_SIZE = 100_000

AUTH_COLUMNS = (
    "time",
    "source_user",
    "destination_user",
    "source_computer",
    "destination_computer",
    "authentication_type",
    "logon_type",
    "authentication_orientation",
    "result",
)


def infer_protocol(authentication_type: str, logon_type: str) -> str:
    """Map LANL's authentication_type/logon_type onto our protocol enum.

    LANL's auth log only records Windows authentication metadata, not raw
    wire protocol -- this mapping is a placeholder heuristic for staging and
    is expected to be revisited during calibration (task 1.7):
      - RemoteInteractive logons are RDP sessions.
      - Kerberos-typed auth stays Kerberos.
      - Other network-oriented logons (NTLM/Negotiate over the network) are
        treated as SMB, the closest analogue to a network file/share logon.
      - Anything else falls back to Kerberos, the modal auth type in the
        dataset, rather than inventing a fifth protocol bucket.
    """
    if logon_type == "RemoteInteractive":
        return "RDP"
    if authentication_type == "Kerberos":
        return "Kerberos"
    if logon_type == "Network":
        return "SMB"
    return "Kerberos"


def infer_w0(result: str) -> float:
    """Placeholder initial-weight heuristic: successful auth is fully weighted,
    failed auth is down-weighted (it did not establish a standing session)."""
    return 1.0 if result.strip().lower() == "success" else 0.6


@dataclass
class StagingStats:
    lines_read: int = 0
    edges_written: int = 0
    lines_skipped: int = 0
    shards_written: int = 0


def _open_maybe_gzip(path: Path) -> TextIO:
    if path.suffix == ".gz":
        return io.TextIOWrapper(gzip.open(path, "rb"), encoding="utf-8", newline="")
    return open(path, "r", encoding="utf-8", newline="")


def parse_auth_stream(fh: TextIO, epoch_start: int) -> Iterator[tuple[Optional[Edge], bool]]:
    """Yield (edge_or_none, was_skipped) for each raw auth.txt row."""
    reader = csv.reader(fh)
    for row in reader:
        if len(row) < len(AUTH_COLUMNS):
            yield None, True
            continue
        record = dict(zip(AUTH_COLUMNS, row))
        try:
            t_e = epoch_start + int(record["time"])
        except ValueError:
            yield None, True
            continue

        user = record["source_user"].split("@")[0]
        dst_computer = record["destination_computer"]
        if not user or not dst_computer:
            yield None, True
            continue

        protocol = infer_protocol(record["authentication_type"], record["logon_type"])
        edge = Edge(
            src=f"User:{user}",
            dst=f"Machine:{dst_computer}",
            edge_type="Authentication",
            protocol=protocol,
            t_e=float(t_e),
            w_0=infer_w0(record["result"]),
            source_system="lanl_replay",
            raw_event_id=record["authentication_orientation"] or None,
        )
        yield edge, False


def stage(
    input_path: Path,
    output_dir: Path,
    epoch_start: int = DEFAULT_EPOCH_START,
    shard_size: int = DEFAULT_SHARD_SIZE,
) -> StagingStats:
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

    with _open_maybe_gzip(input_path) as fh:
        _open_shard()
        for edge, skipped in parse_auth_stream(fh, epoch_start):
            stats.lines_read += 1
            if skipped:
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
        "epoch_start": epoch_start,
        "lines_read": stats.lines_read,
        "edges_written": stats.edges_written,
        "lines_skipped": stats.lines_skipped,
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
    parser.add_argument("--input", required=True, type=Path, help="Path to auth.txt or auth.txt.gz")
    parser.add_argument("--output", required=True, type=Path, help="Directory for staged NDJSON shards")
    parser.add_argument("--epoch-start", type=int, default=DEFAULT_EPOCH_START)
    parser.add_argument("--shard-size", type=int, default=DEFAULT_SHARD_SIZE)
    args = parser.parse_args()

    stats = stage(args.input, args.output, args.epoch_start, args.shard_size)
    print(json.dumps(stats.__dict__, indent=2))


if __name__ == "__main__":
    main()
