import psycopg2
import pytest

from t_gnn.db import (
    assert_test_database, connection_params, get_connection, get_test_db_connection,
    is_safe_test_dbname, resolve_test_dbname,
)


def _postgres_reachable(connect=get_connection) -> bool:
    try:
        with connect() as conn:
            conn.close()
        return True
    except psycopg2.OperationalError:
        return False


requires_postgres = pytest.mark.skipif(
    not _postgres_reachable(), reason="local Postgres (t_gnn_dev) not reachable"
)
requires_test_db = pytest.mark.skipif(
    not _postgres_reachable(get_test_db_connection),
    reason="local Postgres test database not reachable -- run `python scripts/init_postgres.py`",
)


def test_connection_params_read_from_env(monkeypatch):
    monkeypatch.setenv("PGHOST", "example-host")
    monkeypatch.setenv("PGPORT", "1234")
    monkeypatch.setenv("PGDATABASE", "example_db")
    params = connection_params()
    assert params["host"] == "example-host"
    assert params["port"] == 1234
    assert params["dbname"] == "example_db"


@requires_postgres
def test_can_connect_and_query():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            assert cur.fetchone() == (1,)


# Backlog B.9: the guard that keeps destructive test cleanup off t_gnn_dev.

def test_test_dbname_defaults_to_t_gnn_test(monkeypatch):
    monkeypatch.delenv("PGTEST_DATABASE", raising=False)
    assert resolve_test_dbname() == "t_gnn_test"


def test_test_dbname_reads_env(monkeypatch):
    monkeypatch.setenv("PGTEST_DATABASE", "ci_run_test")
    assert resolve_test_dbname() == "ci_run_test"


@pytest.mark.parametrize("name", ["t_gnn_dev", "postgres", "t_gnn", "t_gnn_test_backup"])
def test_unsafe_test_dbnames_rejected(monkeypatch, name):
    monkeypatch.setenv("PGDATABASE", "t_gnn_dev")
    assert not is_safe_test_dbname(name)


def test_dev_database_named_like_a_test_db_is_still_rejected(monkeypatch):
    monkeypatch.setenv("PGDATABASE", "shared_test")
    assert not is_safe_test_dbname("shared_test")


def test_get_test_db_connection_refuses_dev_database(monkeypatch):
    monkeypatch.setenv("PGTEST_DATABASE", "t_gnn_dev")
    with pytest.raises(RuntimeError, match="not a dedicated test database"):
        with get_test_db_connection():
            pass


@requires_test_db
def test_assert_test_database_accepts_test_database():
    with get_test_db_connection() as conn:
        assert_test_database(conn)


@requires_postgres
def test_assert_test_database_refuses_dev_database():
    with get_connection(dbname="t_gnn_dev") as conn:
        with pytest.raises(RuntimeError, match="refusing to clean up"):
            assert_test_database(conn)
