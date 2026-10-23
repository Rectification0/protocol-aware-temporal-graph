"""Submit the Flink decay/baseline job (Backlog B.1) to the compose stack's cluster.

Idempotent: creates the Kafka topics if missing, publishes config/protocols.yaml's
lambda_p values into the job's broadcast-state topic, then submits the job
unless one with the same name is already running (`--replace` cancels it
first -- needed after changing the job's code, which is baked into the
t-gnn-flink image, so rebuild with `docker compose up -d --build` first).

Usage:
    docker compose up -d
    python scripts/submit_flink_job.py
    python scripts/submit_flink_job.py --replace -- --refresh-interval 600
Arguments after `--` are passed to the job (see `decay_job.py --help`).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from t_gnn.flink.kafka_io import DEFAULT_BOOTSTRAP, ensure_topics, make_producer, publish_lambdas  # noqa: E402
from t_gnn.flink.logic import JOB_NAME  # noqa: E402
from t_gnn.protocol_registry import ProtocolDecayRegistry  # noqa: E402

JOB_PATH_IN_IMAGE = "/opt/t_gnn/src/t_gnn/flink/decay_job.py"


def _rest(url: str, method: str = "GET") -> dict:
    with urllib.request.urlopen(urllib.request.Request(url, method=method), timeout=10) as resp:
        body = resp.read()
    return json.loads(body) if body else {}


def running_job_ids(flink_url: str) -> list[str]:
    jobs = _rest(f"{flink_url}/jobs/overview")["jobs"]
    return [j["jid"] for j in jobs if j["name"] == JOB_NAME and j["state"] in ("RUNNING", "CREATED", "RESTARTING", "INITIALIZING")]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--flink-url", default="http://localhost:8081")
    parser.add_argument("--bootstrap-servers", default=DEFAULT_BOOTSTRAP, help="Kafka, as the host sees it")
    parser.add_argument("--replace", action="store_true", help="cancel a running copy of the job, then submit")
    parser.add_argument("--wait", type=float, default=60.0, help="seconds to wait for the job to reach RUNNING")
    parser.add_argument("job_args", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    job_args = args.job_args[1:] if args.job_args[:1] == ["--"] else args.job_args

    ensure_topics(args.bootstrap_servers)
    count = publish_lambdas(make_producer(args.bootstrap_servers), ProtocolDecayRegistry())
    print(f"topics ready; published {count} lambda_p record(s)")

    existing = running_job_ids(args.flink_url)
    if existing and not args.replace:
        print(f"{JOB_NAME} already running ({', '.join(existing)}) -- nothing to do (use --replace to resubmit)")
        return
    for jid in existing:
        _rest(f"{args.flink_url}/jobs/{jid}?mode=cancel", method="PATCH")
        print(f"cancelled {jid}")

    cmd = ["docker", "compose", "exec", "-T", "jobmanager", "flink", "run", "-d", "-py", JOB_PATH_IN_IMAGE, *job_args]
    subprocess.run(cmd, check=True, cwd=Path(__file__).resolve().parents[1])

    deadline = time.monotonic() + args.wait
    while time.monotonic() < deadline:
        jobs = {j["jid"]: j["state"] for j in _rest(f"{args.flink_url}/jobs/overview")["jobs"] if j["name"] == JOB_NAME}
        if "RUNNING" in jobs.values():
            print(f"{JOB_NAME} is RUNNING -- Flink UI: {args.flink_url}")
            return
        time.sleep(1.0)
    sys.exit(f"{JOB_NAME} did not reach RUNNING within {args.wait:.0f}s -- check the Flink UI ({args.flink_url})")


if __name__ == "__main__":
    main()
