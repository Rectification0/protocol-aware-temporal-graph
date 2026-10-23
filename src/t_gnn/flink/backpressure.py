"""Flink backpressure as an epsilon pressure signal (Backlog B.2, design.md §5).

design.md §5's mitigation for "Flink backpressure during log spikes" is to
tighten epsilon, pruning harder while ingestion can't keep up.
`FlinkBackpressureProbe` reads the decay/baseline job's backpressure from
the Flink REST API, and `EpsilonController` turns it into pressure alongside
memory and graph size.

The reading is Flink's own per-subtask `ratio` -- the share of each second a
subtask spent blocked on a full downstream buffer
(`backPressuredTimeMsPerSecond / 1000`) -- maxed over every subtask of every
operator: one stalled operator is enough to back up the source.

Plain `urllib`, no PyFlink or Kafka client, so the pipeline process can poll
it on every pruning pass.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.request
from typing import Iterable, Optional

from t_gnn.flink.logic import JOB_NAME

logger = logging.getLogger(__name__)


def max_backpressure_ratio(vertex_responses: Iterable[dict]) -> Optional[float]:
    """Max subtask `ratio` across `/jobs/:jid/vertices/:vid/backpressure`
    responses; None if none of them carried a reading yet."""
    ratios = [
        float(subtask["ratio"])
        for response in vertex_responses
        if response.get("status") == "ok"
        for subtask in response.get("subtasks", ())
        if "ratio" in subtask
    ]
    return max(ratios) if ratios else None


class FlinkBackpressureProbe:
    """Callable returning the job's current backpressure ratio (0-1), or
    None when there's no reading -- Flink unreachable, job not running, or
    no sample yet. None means "no signal" (no pressure), never an error, so
    a Flink outage can't stall or crash pruning (NFR4)."""

    def __init__(
        self,
        flink_url: str = "http://localhost:8081",
        job_name: str = JOB_NAME,
        timeout: float = 1.0,
        vertex_cache_seconds: float = 30.0,
    ) -> None:
        self.flink_url = flink_url.rstrip("/")
        self.job_name = job_name
        self.timeout = timeout
        self.vertex_cache_seconds = vertex_cache_seconds
        self.available = True
        self.last_ratio: Optional[float] = None
        self._job: Optional[tuple[str, list[str]]] = None
        self._job_fetched_at = 0.0

    def _get(self, path: str) -> dict:
        with urllib.request.urlopen(f"{self.flink_url}{path}", timeout=self.timeout) as resp:
            return json.load(resp)

    def _running_job(self) -> Optional[tuple[str, list[str]]]:
        """(jid, vertex ids) of the running job, cached so a pruning pass
        costs one request per operator rather than a full job lookup."""
        if self._job is not None and time.monotonic() - self._job_fetched_at < self.vertex_cache_seconds:
            return self._job
        jobs = self._get("/jobs/overview")["jobs"]
        jid = next((j["jid"] for j in jobs if j["name"] == self.job_name and j["state"] == "RUNNING"), None)
        self._job = None if jid is None else (jid, [v["id"] for v in self._get(f"/jobs/{jid}")["vertices"]])
        self._job_fetched_at = time.monotonic()
        return self._job

    def __call__(self) -> Optional[float]:
        try:
            job = self._running_job()
            if job is None:
                ratio = None
            else:
                jid, vertices = job
                ratio = max_backpressure_ratio(self._get(f"/jobs/{jid}/vertices/{vid}/backpressure") for vid in vertices)
        except Exception as exc:  # noqa: BLE001 -- any failure is "no signal"
            self._job = None  # the job may have been resubmitted; look it up again
            if self.available:
                logger.warning("Flink backpressure unavailable (%s) -- epsilon ignores it until Flink answers", exc)
            self.available = False
            self.last_ratio = None
            return None
        if not self.available:
            logger.info("Flink backpressure available again")
        self.available = True
        self.last_ratio = ratio
        return ratio
