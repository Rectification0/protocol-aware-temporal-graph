"""Local Postgres connection helper.

Dev-environment note: rather than standing up the full docker-compose.yml
stack (Flink + Redis + Neo4j) immediately, local development currently
targets a Postgres instance the developer already runs (localhost:5432).
Postgres stands in for whatever a given task would otherwise persist to
(e.g. cold-storage-style tables), until/unless that task's real backing
store (Neo4j, Redis) is stood up. Connection settings come from the
environment (see .env.example); no credentials are hardcoded here.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator, Optional

import psycopg2
import psycopg2.extensions

DEFAULT_DBNAME = "t_gnn_dev"


def _load_dotenv(path: str = ".env") -> None:
    """Minimal .env loader: only sets vars not already present in the environment."""
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()


def connection_params(dbname: Optional[str] = None) -> dict:
    return {
        "host": os.environ.get("PGHOST", "localhost"),
        "port": int(os.environ.get("PGPORT", "5432")),
        "dbname": dbname or os.environ.get("PGDATABASE", DEFAULT_DBNAME),
        "user": os.environ.get("PGUSER", "postgres"),
        "password": os.environ.get("PGPASSWORD"),
    }


@contextmanager
def get_connection(dbname: Optional[str] = None) -> Iterator[psycopg2.extensions.connection]:
    conn = psycopg2.connect(**connection_params(dbname))
    try:
        yield conn
    finally:
        conn.close()
