"""Backlog B.1: the real Flink streaming job for decay + baseline (design.md 2.1-2.3).

- `logic.py` -- the per-record business logic and wire formats, free of any
  PyFlink import so the host's Python 3.12 test suite covers it.
- `decay_job.py` -- the PyFlink job itself. Runs only inside the
  `t-gnn-flink` image (docker/flink.Dockerfile, Python 3.10), never on the host.
- `kafka_io.py` -- host-side Kafka helpers (topics, publishing lambda_p
  updates and edges, reading the job's output), via `confluent-kafka`.
"""
