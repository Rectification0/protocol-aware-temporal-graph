import time

import psycopg2
import pytest

from t_gnn.api_state import ApiStateReader, ApiStateWriter, create_api_tables
from t_gnn.db import get_connection
from t_gnn.feedback import MotifFeedbackEvent
from t_gnn.metrics import MetricsSnapshot
from t_gnn.motif_engine import MotifAlertBus, MotifCompletionEvent, MotifResetBus, MotifResetEvent
from t_gnn.tgnn import InferenceResult, InferenceResultBus

_TABLES = (
    "motif_feedback", "alert_acknowledgements", "motif_completions",
    "motif_resets", "entity_scores", "metrics_snapshots", "users",
)


def _postgres_reachable() -> bool:
    try:
        with get_connection() as conn:
            conn.close()
        return True
    except psycopg2.OperationalError:
        return False


requires_postgres = pytest.mark.skipif(
    not _postgres_reachable(), reason="local Postgres (t_gnn_dev) not reachable -- run `docker compose up -d`-adjacent Postgres and `python scripts/init_postgres.py` first",
)


@pytest.fixture(autouse=True)
def _clean_tables():
    if not _postgres_reachable():
        yield
        return
    with get_connection() as conn:
        create_api_tables(conn)
    yield
    with get_connection() as conn:
        with conn.cursor() as cur:
            for table in _TABLES:
                cur.execute(f"DELETE FROM {table}")
        conn.commit()


@requires_postgres
def test_create_api_tables_is_idempotent():
    with get_connection() as conn:
        create_api_tables(conn)
        create_api_tables(conn)


@requires_postgres
def test_metrics_snapshot_round_trip():
    writer = ApiStateWriter(get_connection)
    reader = ApiStateReader(get_connection)
    snapshot = MetricsSnapshot(
        active_graph_size=10, prune_rate_per_second=1.5, epsilon=0.2,
        motif_hit_rate_per_second=0.1, motif_reset_rate_per_second=0.05,
        latest_inference_latency_seconds=0.002,
    )

    writer.record_metrics_snapshot(snapshot, t=time.time())

    assert reader.latest_metrics_snapshot() == snapshot


@requires_postgres
def test_latest_metrics_snapshot_is_none_when_empty():
    reader = ApiStateReader(get_connection)
    assert reader.latest_metrics_snapshot() is None


@requires_postgres
def test_metrics_snapshot_returns_most_recent():
    writer = ApiStateWriter(get_connection)
    reader = ApiStateReader(get_connection)
    older = MetricsSnapshot(1, 1.0, 0.1, 0.1, 0.1, 0.1)
    newer = MetricsSnapshot(2, 2.0, 0.2, 0.2, 0.2, 0.2)

    writer.record_metrics_snapshot(older, t=100.0)
    writer.record_metrics_snapshot(newer, t=200.0)

    assert reader.latest_metrics_snapshot() == newer


@requires_postgres
def test_entity_score_upserts_latest_value():
    writer = ApiStateWriter(get_connection)
    reader = ApiStateReader(get_connection)

    writer.record_entity_score(InferenceResult(entity_id="User:alice", score=1.0, t=100.0, trigger="scheduled"))
    writer.record_entity_score(InferenceResult(entity_id="User:alice", score=2.5, t=200.0, trigger="motif_completion", motif_name="lateral_pivot"))

    scores = reader.list_entity_scores(limit=10)
    assert len(scores) == 1
    assert scores[0].score == 2.5
    assert scores[0].motif_name == "lateral_pivot"


@requires_postgres
def test_entity_scores_sorted_by_abs_score_descending():
    writer = ApiStateWriter(get_connection)
    reader = ApiStateReader(get_connection)

    writer.record_entity_score(InferenceResult(entity_id="User:a", score=-5.0, t=1.0, trigger="scheduled"))
    writer.record_entity_score(InferenceResult(entity_id="User:b", score=1.0, t=1.0, trigger="scheduled"))
    writer.record_entity_score(InferenceResult(entity_id="User:c", score=3.0, t=1.0, trigger="scheduled"))

    scores = reader.list_entity_scores(limit=10)
    assert [s.entity_id for s in scores] == ["User:a", "User:c", "User:b"]


@requires_postgres
def test_entity_scores_start_end_filters_on_t_and_count_matches():
    writer = ApiStateWriter(get_connection)
    reader = ApiStateReader(get_connection)
    writer.record_entity_score(InferenceResult(entity_id="User:old", score=1.0, t=100.0, trigger="scheduled"))
    writer.record_entity_score(InferenceResult(entity_id="User:mid", score=2.0, t=200.0, trigger="scheduled"))
    writer.record_entity_score(InferenceResult(entity_id="User:new", score=3.0, t=300.0, trigger="scheduled"))

    scores = reader.list_entity_scores(limit=10, start=150.0, end=250.0)

    assert [s.entity_id for s in scores] == ["User:mid"]
    assert reader.count_entity_scores(start=150.0, end=250.0) == 1
    assert reader.count_entity_scores() == 3


@requires_postgres
def test_motif_completion_round_trip():
    writer = ApiStateWriter(get_connection)
    reader = ApiStateReader(get_connection)
    event = MotifCompletionEvent(
        motif_name="lateral_pivot", chain_key="Machine:C1042",
        matched_edges=["e1", "e2"], completed_at=123.0, confidence=0.9,
    )

    writer.record_motif_completion(event)

    records = reader.list_motif_completions(limit=10)
    assert len(records) == 1
    assert records[0].motif_name == "lateral_pivot"
    assert records[0].matched_edges == ["e1", "e2"]
    assert records[0].confidence == 0.9


@requires_postgres
def test_motif_completion_filters_by_motif_name():
    writer = ApiStateWriter(get_connection)
    reader = ApiStateReader(get_connection)
    writer.record_motif_completion(MotifCompletionEvent("lateral_pivot", "Machine:C1042", ["e1"], 1.0))
    writer.record_motif_completion(MotifCompletionEvent("admin_share_escalation", "User:svc", ["e2"], 2.0))

    records = reader.list_motif_completions(limit=10, motif_name="admin_share_escalation")

    assert len(records) == 1
    assert records[0].motif_name == "admin_share_escalation"


@requires_postgres
def test_motif_completions_start_end_filters_on_completed_at_and_count_matches():
    writer = ApiStateWriter(get_connection)
    reader = ApiStateReader(get_connection)
    writer.record_motif_completion(MotifCompletionEvent("lateral_pivot", "Machine:C1", ["e1"], 100.0))
    writer.record_motif_completion(MotifCompletionEvent("lateral_pivot", "Machine:C2", ["e2"], 200.0))
    writer.record_motif_completion(MotifCompletionEvent("lateral_pivot", "Machine:C3", ["e3"], 300.0))

    records = reader.list_motif_completions(limit=10, start=150.0, end=250.0)

    assert [r.chain_key for r in records] == ["Machine:C2"]
    assert reader.count_motif_completions(start=150.0, end=250.0) == 1
    assert reader.count_motif_completions() == 3
    assert reader.count_motif_completions(motif_name="admin_share_escalation") == 0


@requires_postgres
def test_motif_reset_round_trip():
    writer = ApiStateWriter(get_connection)
    reader = ApiStateReader(get_connection)
    event = MotifResetEvent(
        motif_name="lateral_pivot", chain_key="Machine:C1042",
        triggering_edge_id="e1", matched_edges=["e1"], reset_at=50.0,
    )

    writer.record_motif_reset(event)

    records = reader.list_motif_resets(limit=10)
    assert len(records) == 1
    assert records[0].triggering_edge_id == "e1"


@requires_postgres
def test_motif_feedback_round_trip_creates_user():
    writer = ApiStateWriter(get_connection)
    reader = ApiStateReader(get_connection)
    event = MotifFeedbackEvent(
        motif_name="lateral_pivot", chain_key="Machine:C1042",
        disposition="true_positive", noted_at=time.time(), analyst="alice",
    )

    writer.record_motif_feedback(event)

    records = reader.list_motif_feedback(limit=10)
    assert len(records) == 1
    assert records[0].disposition == "true_positive"
    assert records[0].analyst == "alice"

    # a second disposition from the same analyst reuses the same user row
    writer.record_motif_feedback(MotifFeedbackEvent("lateral_pivot", "Machine:C1043", "false_positive", time.time(), analyst="alice"))
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM users WHERE username = 'alice'")
            assert cur.fetchone()[0] == 1


@requires_postgres
def test_motif_feedback_without_analyst_leaves_null_attribution():
    writer = ApiStateWriter(get_connection)
    reader = ApiStateReader(get_connection)
    writer.record_motif_feedback(MotifFeedbackEvent("lateral_pivot", "Machine:C1042", "true_positive", time.time()))

    records = reader.list_motif_feedback(limit=10)
    assert records[0].analyst is None


@requires_postgres
def test_motif_completions_since_returns_only_newer_rows_ascending():
    """F0.10's SSE poll cursor: `since`-by-id, ascending, not the DESC
    "recent page" `list_motif_completions` returns for a one-shot listing."""
    writer = ApiStateWriter(get_connection)
    reader = ApiStateReader(get_connection)
    writer.record_motif_completion(MotifCompletionEvent("lateral_pivot", "Machine:C1042", ["e1"], 1.0))
    writer.record_motif_completion(MotifCompletionEvent("admin_share_escalation", "User:svc", ["e2"], 2.0))
    first_id = reader.list_motif_completions(limit=10)[-1].id  # oldest of the two just written

    records = reader.list_motif_completions_since(first_id)

    assert len(records) == 1
    assert records[0].motif_name == "admin_share_escalation"


@requires_postgres
def test_motif_completions_since_zero_returns_everything():
    writer = ApiStateWriter(get_connection)
    reader = ApiStateReader(get_connection)
    writer.record_motif_completion(MotifCompletionEvent("lateral_pivot", "Machine:C1042", ["e1"], 1.0))

    assert len(reader.list_motif_completions_since(0)) == 1


@requires_postgres
def test_motif_resets_since_returns_only_newer_rows():
    writer = ApiStateWriter(get_connection)
    reader = ApiStateReader(get_connection)
    writer.record_motif_reset(MotifResetEvent("lateral_pivot", "Machine:C1042", "e1", ["e1"], 1.0))
    writer.record_motif_reset(MotifResetEvent("lateral_pivot", "Machine:C1043", "e2", ["e2"], 2.0))
    first_id = reader.list_motif_resets(limit=10)[-1].id

    records = reader.list_motif_resets_since(first_id)

    assert len(records) == 1
    assert records[0].triggering_edge_id == "e2"


@requires_postgres
def test_entity_scores_since_returns_only_rows_updated_after_cursor():
    writer = ApiStateWriter(get_connection)
    reader = ApiStateReader(get_connection)
    writer.record_entity_score(InferenceResult(entity_id="User:alice", score=1.0, t=1.0, trigger="scheduled"))
    cursor = time.time()
    writer.record_entity_score(InferenceResult(entity_id="User:bob", score=2.0, t=2.0, trigger="scheduled"))

    updates = reader.list_entity_scores_since(cursor)

    assert len(updates) == 1
    assert updates[0].result.entity_id == "User:bob"
    assert updates[0].updated_at > cursor


@requires_postgres
def test_alert_acknowledgement_round_trip():
    writer = ApiStateWriter(get_connection)
    reader = ApiStateReader(get_connection)

    writer.record_alert_acknowledgement(
        detection_type="motif_completion", detection_ref="lateral_pivot:Machine:C1042:123.0",
        analyst="bob", notes="confirmed with the on-call team", t=time.time(),
    )

    records = reader.list_alert_acknowledgements(limit=10)
    assert len(records) == 1
    assert records[0].acknowledged_by == "bob"
    assert records[0].notes == "confirmed with the on-call team"


@requires_postgres
def test_writer_auto_subscribes_to_buses():
    alert_bus = MotifAlertBus()
    reset_bus = MotifResetBus()
    result_bus = InferenceResultBus()
    ApiStateWriter(get_connection, alert_bus=alert_bus, reset_bus=reset_bus, result_bus=result_bus)
    reader = ApiStateReader(get_connection)

    alert_bus.publish(MotifCompletionEvent("lateral_pivot", "Machine:C1042", ["e1"], 1.0))
    reset_bus.publish(MotifResetEvent("lateral_pivot", "Machine:C1042", "e1", ["e1"], 2.0))
    result_bus.publish(InferenceResult(entity_id="User:alice", score=1.0, t=3.0, trigger="scheduled"))

    assert len(reader.list_motif_completions(limit=10)) == 1
    assert len(reader.list_motif_resets(limit=10)) == 1
    assert len(reader.list_entity_scores(limit=10)) == 1


def test_writer_degrades_gracefully_when_postgres_unreachable():
    """No `requires_postgres` marker -- this test exercises the failure
    path itself and must run whether or not a real Postgres is up, the
    same way `tests/test_chaos.py`'s Redis-outage test simulates the
    failure directly rather than requiring an actual outage."""
    def _broken_connection_factory():
        raise psycopg2.OperationalError("simulated outage")

    writer = ApiStateWriter(_broken_connection_factory)
    snapshot = MetricsSnapshot(1, 1.0, 0.1, 0.1, 0.1, 0.1)

    writer.record_metrics_snapshot(snapshot, t=time.time())

    assert writer.available is False
