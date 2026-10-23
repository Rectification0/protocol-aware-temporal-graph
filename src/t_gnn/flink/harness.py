"""A throwaway copy of the Flink decay/baseline job on its own topics.

Used by tests/test_flink_job.py and the NFR2 benchmark (`t_gnn.bench flink`,
Backlog B.7): each run gets unique topics and a unique job name, so driving
its event-time clock or overloading it can't touch the long-running
`t-gnn-decay-baseline` job. On exit the job is cancelled -- waiting until it
really is, since a still-connected source would re-create a deleted topic
through the broker's auto-creation -- and its topics are deleted.

Needs the compose stack (`docker compose up -d`) and the [flink] extra.
"""

from __future__ import annotations

import json
import subprocess
import time
import urllib.request
import uuid
from pathlib import Path
from typing import Optional

from confluent_kafka.admin import AdminClient

from t_gnn.flink.kafka_io import DEFAULT_BOOTSTRAP, ensure_topics

REPO_ROOT = Path(__file__).resolve().parents[3]
JOB_PATH_IN_IMAGE = "/opt/t_gnn/src/t_gnn/flink/decay_job.py"
DEFAULT_FLINK_URL = "http://localhost:8081"


def flink_jobs(flink_url: str = DEFAULT_FLINK_URL) -> dict[str, dict]:
    """Jobs by name; a resubmitted name maps to its newest run."""
    with urllib.request.urlopen(f"{flink_url}/jobs/overview", timeout=5) as resp:
        jobs = sorted(json.load(resp)["jobs"], key=lambda j: j["start-time"])
    return {j["name"]: j for j in jobs}


def stack_up(bootstrap: str = DEFAULT_BOOTSTRAP, flink_url: str = DEFAULT_FLINK_URL) -> bool:
    try:
        AdminClient({"bootstrap.servers": bootstrap}).list_topics(timeout=2)
        urllib.request.urlopen(f"{flink_url}/overview", timeout=2)
        return True
    except Exception:
        return False


class IsolatedJob:
    """Context manager: `with IsolatedJob(prefix, ["--refresh-interval", "60"]) as job:`
    then use `job.topics[...]` ("edges", "lambdas", "decayed", "weights") and
    `job.name`. Edges are read from the start of the topic (`--edges-from
    earliest`), so nothing produced right after startup is missed."""

    def __init__(
        self,
        prefix: str,
        job_args: Optional[list[str]] = None,
        bootstrap: str = DEFAULT_BOOTSTRAP,
        flink_url: str = DEFAULT_FLINK_URL,
        start_timeout: float = 90.0,
    ) -> None:
        uid = uuid.uuid4().hex[:8]
        self.name = f"{prefix}-{uid}"
        self.topics = {kind: f"{prefix}-{uid}.{kind}" for kind in ("edges", "lambdas", "decayed", "weights")}
        self.job_args = job_args or []
        self.bootstrap = bootstrap
        self.flink_url = flink_url
        self.start_timeout = start_timeout

    def __enter__(self) -> "IsolatedJob":
        ensure_topics(self.bootstrap, lambdas_topic=self.topics["lambdas"],
                      stream_topics=(self.topics["edges"], self.topics["decayed"], self.topics["weights"]))
        try:
            subprocess.run(
                ["docker", "compose", "exec", "-T", "jobmanager", "flink", "run", "-d", "-py", JOB_PATH_IN_IMAGE,
                 "--job-name", self.name, "--edges-from", "earliest",
                 "--edges-topic", self.topics["edges"], "--lambdas-topic", self.topics["lambdas"],
                 "--decayed-topic", self.topics["decayed"], "--weights-topic", self.topics["weights"],
                 *self.job_args],
                check=True, cwd=REPO_ROOT, capture_output=True,
            )
            deadline = time.monotonic() + self.start_timeout
            while flink_jobs(self.flink_url).get(self.name, {}).get("state") != "RUNNING":
                if time.monotonic() > deadline:
                    raise TimeoutError(f"{self.name} never reached RUNNING")
                time.sleep(1.0)
        except BaseException:
            self.__exit__(None, None, None)
            raise
        return self

    def __exit__(self, *exc) -> None:
        jid = flink_jobs(self.flink_url).get(self.name, {}).get("jid")
        if jid:
            urllib.request.urlopen(
                urllib.request.Request(f"{self.flink_url}/jobs/{jid}?mode=cancel", method="PATCH"), timeout=10
            )
            deadline = time.monotonic() + 60
            while flink_jobs(self.flink_url).get(self.name, {}).get("state") != "CANCELED" and time.monotonic() < deadline:
                time.sleep(1.0)
        admin = AdminClient({"bootstrap.servers": self.bootstrap})  # held: its futures die with it
        for future in admin.delete_topics(list(self.topics.values())).values():
            try:
                future.result(timeout=10)
            except Exception:
                pass  # never created (startup failed early) -- nothing to clean
