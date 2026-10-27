"""Idempotently create the local dev Postgres database (t_gnn.db.DEFAULT_DBNAME)
and the frontend API layer's tables within it.

Connects to the `postgres` maintenance database using the same credentials
as t_gnn.db.connection_params, then creates the target database if it does
not already exist. Table creation was originally deferred to whichever
future task first needed a table -- tasks.md Milestone F0 (the frontend's
backend API layer) is that task: `t_gnn.api_state.create_api_tables()` owns
the DDL for the tables the API service reads/writes (users,
metrics_snapshots, entity_scores, motif_completions, motif_resets,
motif_feedback, alert_acknowledgements). Both steps are idempotent, so this
script is safe to re-run on every dev-environment setup.

Usage:
    python scripts/init_postgres.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import psycopg2  # noqa: E402

from t_gnn.api_state import create_api_tables  # noqa: E402
from t_gnn.db import connection_params, get_connection, resolve_test_dbname  # noqa: E402


def _ensure_database_exists(target_db: str) -> None:
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


def main() -> None:
    # Backlog B.9: the test database is created alongside the dev one, so
    # tests/test_api_state.py's per-test wipe never touches t_gnn_dev.
    for target_db in (connection_params()["dbname"], resolve_test_dbname()):
        _ensure_database_exists(target_db)
        with get_connection(dbname=target_db) as conn:
            create_api_tables(conn)
        print(f"frontend API tables ready in {target_db!r} (users, metrics_snapshots, "
              "entity_scores, motif_completions, motif_resets, motif_feedback, "
              "alert_acknowledgements, config_changes)")


if __name__ == "__main__":
    main()
