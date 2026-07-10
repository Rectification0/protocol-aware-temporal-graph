"""Synthetic labeled enterprise-traffic generator (extends tasks.md 7.3's pilot harness).

The pilot harness (`t_gnn.pilot`) and the detection pipeline it evaluates
need labeled traffic to test against; the only ground truth vendored in
this repo is the tiny 5-row smoke-test fixture
(`data/lanl/raw/sample_auth.txt.gz` + `sample_redteam.txt`), too small to
meaningfully exercise either detection path. Acquiring real enterprise
traffic (or the real LANL dataset) is the operational step tasks.md
0.4/7.3 both document as out of scope for this repo. This module fills
that gap with *synthetic* traffic at a configurable, meaningful scale --
still not a substitute for a real pilot (see `docs/operational-runbook.md`
"Running a pilot evaluation"), but enough signal to validate the
pipeline's mechanics (decay, baseline deviation, motif delta-update, pilot
evaluation) locally.

Operates directly on `Edge` objects rather than round-tripping through
LANL's raw `auth.txt` text format (`stage_lanl.py`'s input format) --
`auth.txt`'s vocabulary can't express `FileTransfer`/`RemoteCodeExecution`
edge types or an unusual `w_0`, both needed to inject the
`admin_share_escalation` motif and a controllable "low and slow" anomaly.
Output is the same staged NDJSON shard format `stage_lanl.stage()`
produces, so it's a drop-in `--staged-dir` for `pilot.py` (or anything
else downstream) without a second staging hop.

Four generators, all driven by a single seeded `random.Random` for
reproducibility:
  - `generate_background_traffic()`: benign authentication noise -- each
    user has a small set of "home" machines it authenticates to routinely,
    at randomized times and a plausible protocol mix.
  - `inject_lateral_pivot()`: specs.md FR3.1's canonical two-hop pattern
    (Machine A -> Machine B, then B's `{name}-admin` account -> Machine C
    within the motif's window) -- matches `lateral_pivot`'s `host_admin`
    resolver (motifs.py) by construction, since background traffic never
    produces a Machine->Machine or `-admin`-suffixed edge to collide with.
  - `inject_admin_share_escalation()`: FR3.1's other seed motif (a user
    authenticates to a service account, which then writes to a share via
    FileTransfer/SMB) -- background traffic never produces a User->User or
    FileTransfer edge, so this can't collide with it either.
  - `inject_low_and_slow_anomaly()`: an already-established user's history
    gets one sharply heavier-weighted event injected, the same shape
    tests/test_tgnn_e2e.py's 5.4 test constructs by hand -- meant to be
    flagged by FR1.5's z-score, not by either motif.

Every injected event is recorded in a `redteam.txt`-compatible label file
(`write_redteam_labels()`) for `pilot.py` to score detection against.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

from t_gnn.data.stage_lanl import DEFAULT_EPOCH_START, DEFAULT_SHARD_SIZE
from t_gnn.pilot import RedTeamLabel
from t_gnn.schema import Edge

BACKGROUND_PROTOCOLS = ("Kerberos", "SMB", "RDP")
BACKGROUND_PROTOCOL_WEIGHTS = (0.6, 0.3, 0.1)


def _machine(i: int) -> str:
    return f"C{1000 + i}"


def _user(i: int) -> str:
    return f"u{i}"


def generate_background_traffic(
    rng: random.Random,
    num_users: int,
    num_machines: int,
    duration_seconds: float,
    events_per_user_per_day: float = 3.0,
    epoch_start: int = DEFAULT_EPOCH_START,
) -> list[Edge]:
    """Benign authentication noise: each user authenticates to 1-3 "home"
    machines routinely, at randomized times across `duration_seconds`."""
    machines = [_machine(i) for i in range(num_machines)]
    days = max(1.0, duration_seconds / 86400.0)
    edges: list[Edge] = []
    for u in range(num_users):
        user = _user(u)
        home_machines = rng.sample(machines, k=min(len(machines), rng.randint(1, 3)))
        n_events = max(1, round(events_per_user_per_day * days))
        for _ in range(n_events):
            t = epoch_start + rng.uniform(0, duration_seconds)
            dst = rng.choice(home_machines)
            protocol = rng.choices(BACKGROUND_PROTOCOLS, weights=BACKGROUND_PROTOCOL_WEIGHTS)[0]
            # Slight jitter around 1.0 (not a flat constant) so each user's
            # baseline has nonzero variance -- without it, w_0 == 1.0 every
            # time gives EWMABaseline zero variance and z-scores are always
            # None regardless of how extreme a later injected anomaly is
            # (the same fix tests/test_tgnn_e2e.py's 5.4 scenario needed).
            w_0 = 0.6 if rng.random() < 0.02 else rng.uniform(0.95, 1.05)
            edges.append(Edge(
                src=f"User:{user}", dst=f"Machine:{dst}", edge_type="Authentication",
                protocol=protocol, t_e=t, w_0=w_0, source_system="simulated",
            ))
    return edges


def inject_lateral_pivot(
    rng: random.Random,
    machines: list[str],
    t_start: float,
    hop_gap_seconds: float = 3600.0,
) -> tuple[list[Edge], list[RedTeamLabel]]:
    """specs.md FR3.1's canonical two-hop pattern. `machine_b`'s admin
    account is named `f"{machine_b}-admin"` so `HostAdminKeyResolver`
    (motifs.py) recognizes it by construction."""
    machine_a, machine_b, machine_c = rng.sample(machines, 3)
    admin_user = f"{machine_b}-admin"

    hop1 = Edge(
        src=f"Machine:{machine_a}", dst=f"Machine:{machine_b}", edge_type="Authentication",
        protocol="Kerberos", t_e=t_start, w_0=1.0, source_system="simulated",
    )
    hop2 = Edge(
        src=f"User:{admin_user}", dst=f"Machine:{machine_c}", edge_type="RemoteCodeExecution",
        protocol="RDP", t_e=t_start + hop_gap_seconds, w_0=1.0, source_system="simulated",
    )
    label = RedTeamLabel(t=hop2.t_e, user=admin_user, source_computer=machine_b, destination_computer=machine_c)
    return [hop1, hop2], [label]


def inject_admin_share_escalation(
    rng: random.Random,
    num_users: int,
    machines: list[str],
    t_start: float,
    hop_gap_seconds: float = 300.0,
) -> tuple[list[Edge], list[RedTeamLabel]]:
    """FR3.1's other seed motif: a user authenticates as a service
    account, which then writes to an administrative share."""
    user = _user(rng.randint(0, num_users - 1))
    svc_account = f"svc-{rng.randint(1000, 9999)}"
    target_machine = rng.choice(machines)

    hop1 = Edge(
        src=f"User:{user}", dst=f"User:{svc_account}", edge_type="Authentication",
        protocol="Kerberos", t_e=t_start, w_0=1.0, source_system="simulated",
    )
    hop2 = Edge(
        src=f"User:{svc_account}", dst=f"Machine:{target_machine}", edge_type="FileTransfer",
        protocol="SMB", t_e=t_start + hop_gap_seconds, w_0=1.0, source_system="simulated",
    )
    label = RedTeamLabel(t=hop2.t_e, user=svc_account, source_computer=user, destination_computer=target_machine)
    return [hop1, hop2], [label]


def inject_low_and_slow_anomaly(
    rng: random.Random,
    num_users: int,
    machines: list[str],
    t: float,
    anomalous_w_0: float = 9.0,
) -> tuple[Edge, RedTeamLabel]:
    """A single sharply heavier-weighted event for an already-established
    user (tests/test_tgnn_e2e.py's 5.4 scenario) -- meant to be caught by
    FR1.5's z-score against that user's baseline, not by either motif.
    `t` should fall well after traffic generation starts, so the user has
    accumulated enough prior history for a z-score to exist at all
    (baseline.py's `MIN_SAMPLES_FOR_DEVIATION`)."""
    user = _user(rng.randint(0, num_users - 1))
    target_machine = rng.choice(machines)
    edge = Edge(
        src=f"User:{user}", dst=f"Machine:{target_machine}", edge_type="Authentication",
        protocol="Kerberos", t_e=t, w_0=anomalous_w_0, source_system="simulated",
    )
    label = RedTeamLabel(t=t, user=user, source_computer="", destination_computer=target_machine)
    return edge, label


def write_staged_shards(edges: list[Edge], output_dir: Path, shard_size: int = DEFAULT_SHARD_SIZE) -> int:
    """Writes `edges` (sorted by `t_e`) as the same NDJSON shard format
    `stage_lanl.stage()` produces, so it's a drop-in `--staged-dir`."""
    output_dir.mkdir(parents=True, exist_ok=True)
    ordered = sorted(edges, key=lambda e: e.t_e)

    shards_written = 0
    for shard_idx, start in enumerate(range(0, len(ordered), shard_size)):
        chunk = ordered[start:start + shard_size]
        shard_path = output_dir / f"shard-{shard_idx:05d}.jsonl"
        with open(shard_path, "w", encoding="utf-8") as f:
            for edge in chunk:
                f.write(edge.to_json() + "\n")
        shards_written += 1
    if not ordered:
        (output_dir / "shard-00000.jsonl").touch()
        shards_written = 1
    return shards_written


def write_redteam_labels(labels: list[RedTeamLabel], path: Path, epoch_start: int = DEFAULT_EPOCH_START) -> None:
    """Writes `labels` as a `redteam.txt`-format file (`t_gnn.pilot`'s
    `load_redteam_labels()` reads this format back), sorted chronologically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        for label in sorted(labels, key=lambda l: l.t):
            offset = int(round(label.t - epoch_start))
            f.write(f"{offset},{label.user}@CORP,{label.source_computer},{label.destination_computer}\n")


def simulate(
    seed: int,
    num_users: int,
    num_machines: int,
    duration_seconds: float,
    events_per_user_per_day: float = 3.0,
    num_lateral_pivots: int = 3,
    num_admin_share_escalations: int = 3,
    num_anomalies: int = 3,
    epoch_start: int = DEFAULT_EPOCH_START,
) -> tuple[list[Edge], list[RedTeamLabel]]:
    """Generates one full scenario: background traffic plus all three
    injected-attack kinds, returned as `(edges, labels)`."""
    rng = random.Random(seed)
    machines = [_machine(i) for i in range(num_machines)]

    edges = generate_background_traffic(rng, num_users, num_machines, duration_seconds, events_per_user_per_day, epoch_start)
    labels: list[RedTeamLabel] = []

    for _ in range(num_lateral_pivots):
        t_start = epoch_start + rng.uniform(0, max(1.0, duration_seconds - 14400.0))
        new_edges, new_labels = inject_lateral_pivot(rng, machines, t_start)
        edges.extend(new_edges)
        labels.extend(new_labels)

    for _ in range(num_admin_share_escalations):
        t_start = epoch_start + rng.uniform(0, max(1.0, duration_seconds - 3600.0))
        new_edges, new_labels = inject_admin_share_escalation(rng, num_users, machines, t_start)
        edges.extend(new_edges)
        labels.extend(new_labels)

    for _ in range(num_anomalies):
        # Injected in the back half of the window so the chosen user has
        # accumulated baseline history first.
        t = epoch_start + rng.uniform(duration_seconds * 0.5, duration_seconds)
        edge, label = inject_low_and_slow_anomaly(rng, num_users, machines, t)
        edges.append(edge)
        labels.append(label)

    return edges, labels


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--num-users", type=int, default=200)
    parser.add_argument("--num-machines", type=int, default=50)
    parser.add_argument("--days", type=float, default=7.0)
    parser.add_argument("--events-per-user-per-day", type=float, default=3.0)
    parser.add_argument("--num-lateral-pivots", type=int, default=3)
    parser.add_argument("--num-admin-share-escalations", type=int, default=3)
    parser.add_argument("--num-anomalies", type=int, default=3)
    parser.add_argument("--epoch-start", type=int, default=DEFAULT_EPOCH_START)
    parser.add_argument("--shard-size", type=int, default=DEFAULT_SHARD_SIZE)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    edges, labels = simulate(
        seed=args.seed,
        num_users=args.num_users,
        num_machines=args.num_machines,
        duration_seconds=args.days * 86400.0,
        events_per_user_per_day=args.events_per_user_per_day,
        num_lateral_pivots=args.num_lateral_pivots,
        num_admin_share_escalations=args.num_admin_share_escalations,
        num_anomalies=args.num_anomalies,
        epoch_start=args.epoch_start,
    )

    staged_dir = args.output_dir / "staged"
    shards_written = write_staged_shards(edges, staged_dir, args.shard_size)
    redteam_path = args.output_dir / "redteam.txt"
    write_redteam_labels(labels, redteam_path, args.epoch_start)

    print(json.dumps({
        "edges_written": len(edges),
        "labels_written": len(labels),
        "shards_written": shards_written,
        "staged_dir": str(staged_dir),
        "redteam_path": str(redteam_path),
    }, indent=2))


if __name__ == "__main__":
    main()
