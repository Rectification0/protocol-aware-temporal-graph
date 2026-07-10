"""Idempotently create the local dev Postgres database (t_gnn.db.DEFAULT_DBNAME).

Connects to the `postgres` maintenance database using the same credentials
as t_gnn.db.connection_params, then creates the target database if it does
not already exist. Table creation is intentionally deferred to whichever
future task first needs a table (e.g. Phase 4 cold storage) -- this script
only guarantees the database itself exists.

Usage:
    python scripts/init_postgres.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import psycopg2  # noqa: E402

from t_gnn.db import connection_params  # noqa: E402


def main() -> None:
    target_db = connection_params()["dbname"]
    maint_params = connection_params(dbname="postgres")

    conn = psycopg2.connect(**maint_params)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (target_db,))
            if cur.fetchone():
                print(f"database {target_db!r} already exists")
                return
            cur.execute(f'CREATE DATABASE "{target_db}"')
            print(f"created database {target_db!r}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
