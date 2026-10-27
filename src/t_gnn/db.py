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
# Backlog B.9: the database the Postgres-backed tests write to and wipe.
# Overridable via PGTEST_DATABASE, but the name must end in "_test" (see
# assert_test_database()), so a typo can't point the cleanup at real data.
DEFAULT_TEST_DBNAME = "t_gnn_test"


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


def resolve_test_dbname() -> str:
    """The test database's name: PGTEST_DATABASE, else DEFAULT_TEST_DBNAME."""
    return os.environ.get("PGTEST_DATABASE", DEFAULT_TEST_DBNAME)


def is_safe_test_dbname(name: str) -> bool:
    """A database the tests may wipe: ends in "_test" and isn't the dev database."""
    dev_name = os.environ.get("PGDATABASE", DEFAULT_DBNAME)
    return name.endswith("_test") and name not in (dev_name, DEFAULT_DBNAME)


@contextmanager
def get_test_db_connection() -> Iterator[psycopg2.extensions.connection]:
    """get_connection() against the test database, for Postgres-backed tests.

    Refuses an unsafe PGTEST_DATABASE up front, so tests never even write
    their fixture rows into the dev database.
    """
    name = resolve_test_dbname()
    if not is_safe_test_dbname(name):
        raise RuntimeError(
            f"PGTEST_DATABASE={name!r} is not a dedicated test database: "
            f"the name must end in '_test' and differ from the dev database"
        )
    with get_connection(dbname=name) as conn:
        yield conn


def assert_test_database(conn: psycopg2.extensions.connection) -> None:
    """Raise unless `conn` is connected to a database the tests may wipe.

    Checks the server's own current_database(), not the name we asked for,
    so destructive test cleanup can never land on t_gnn_dev.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT current_database()")
        actual = cur.fetchone()[0]
    if actual != resolve_test_dbname() or not is_safe_test_dbname(actual):
        raise RuntimeError(
            f"refusing to clean up database {actual!r}: test cleanup only runs against "
            f"a dedicated *_test database (expected {resolve_test_dbname()!r})"
        )
