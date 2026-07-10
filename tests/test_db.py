import psycopg2
import pytest

from t_gnn.db import connection_params, get_connection


def _postgres_reachable() -> bool:
    try:
        with get_connection() as conn:
            conn.close()
        return True
    except psycopg2.OperationalError:
        return False


pytestmark = pytest.mark.skipif(
    not _postgres_reachable(), reason="local Postgres (t_gnn_dev) not reachable"
)


def test_connection_params_read_from_env(monkeypatch):
    monkeypatch.setenv("PGHOST", "example-host")
    monkeypatch.setenv("PGPORT", "1234")
    monkeypatch.setenv("PGDATABASE", "example_db")
    params = connection_params()
    assert params["host"] == "example-host"
    assert params["port"] == 1234
    assert params["dbname"] == "example_db"


def test_can_connect_and_query():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            assert cur.fetchone() == (1,)
