"""HTTP-layer tests for the frontend API service (tasks.md F0).

Deliberately doesn't require live Postgres/Neo4j -- `app.dependency_overrides`
swaps in in-memory fakes for `get_reader`/`get_writer`/`get_forensics_api`,
the same role `InMemoryColdStorageWriter`/`InMemoryMotifStateStore` play
elsewhere in this codebase's test suite. Round-trip correctness against a
*real* Postgres is `tests/test_api_state.py`'s job; this file only checks
that each endpoint wires its dependency correctly, applies F0.15's
pagination/error conventions, and returns the documented shape.
`config/protocols.yaml`+`config/motifs.yaml`-backed endpoints use the real
registries, since those need no live infra to read.
"""

import json
import time

import pytest
from fastapi.testclient import TestClient

from t_gnn.api import deps
from t_gnn.api.app import app
from t_gnn.api.deps import StreamConfig
from t_gnn.api_state import (
    AlertAcknowledgementRecord,
    AlertResponseTimeStats,
    EntityScoreUpdate,
    MotifCompletionRecord,
    MotifFeedbackRecord,
    MotifResetRecord,
)
from t_gnn.audit import FileAuditSink
from t_gnn.forensics import PrunedEdgeRecord
from t_gnn.metrics import MetricsSnapshot
from t_gnn.tgnn import InferenceResult


class FakeApiState:
    """Duck-types both `ApiStateReader`'s and `ApiStateWriter`'s methods
    used by the routers -- a single in-memory fake standing in for both
    sides of the same Postgres tables, the same relationship
    `InMemoryColdStorageWriter` has to `Neo4jColdStorageWriter`."""

    def __init__(self):
        self.snapshot = None
        self.scores: list[InferenceResult] = []
        self.completions: list[MotifCompletionRecord] = []
        self.resets: list[MotifResetRecord] = []
        self.score_updates: list[EntityScoreUpdate] = []
        self.feedback: list[MotifFeedbackRecord] = []
        self.acks: list[AlertAcknowledgementRecord] = []
        self._next_feedback_id = 1
        self._next_ack_id = 1

    def latest_metrics_snapshot(self):
        return self.snapshot

    def _scores_in_range(self, start=None, end=None):
        return [s for s in self.scores if (start is None or s.t >= start) and (end is None or s.t <= end)]

    def list_entity_scores(self, limit=50, offset=0, start=None, end=None):
        return self._scores_in_range(start, end)[offset:offset + limit]

    def count_entity_scores(self, start=None, end=None):
        return len(self._scores_in_range(start, end))

    def get_entity_score(self, entity_id):
        return next((s for s in self.scores if s.entity_id == entity_id), None)

    def _completions_matching(self, motif_name=None, chain_key=None, start=None, end=None):
        return [
            c for c in self.completions
            if (motif_name is None or c.motif_name == motif_name)
            and (chain_key is None or c.chain_key == chain_key)
            and (start is None or c.completed_at >= start)
            and (end is None or c.completed_at <= end)
        ]

    def list_motif_completions(self, limit=50, offset=0, motif_name=None, chain_key=None, start=None, end=None):
        return self._completions_matching(motif_name, chain_key, start, end)[offset:offset + limit]

    def count_motif_completions(self, motif_name=None, chain_key=None, start=None, end=None):
        return len(self._completions_matching(motif_name, chain_key, start, end))

    def list_motif_resets(self, limit=50, offset=0):
        return self.resets[offset:offset + limit]

    def list_motif_completions_since(self, min_id, limit=100):
        return sorted((c for c in self.completions if c.id > min_id), key=lambda c: c.id)[:limit]

    def list_motif_resets_since(self, min_id, limit=100):
        return sorted((r for r in self.resets if r.id > min_id), key=lambda r: r.id)[:limit]

    def list_entity_scores_since(self, min_updated_at, limit=100):
        return [u for u in self.score_updates if u.updated_at > min_updated_at][:limit]

    def list_motif_feedback(self, limit=50, offset=0):
        return list(reversed(self.feedback))[offset:offset + limit]

    def list_alert_acknowledgements(self, limit=50, offset=0):
        return list(reversed(self.acks))[offset:offset + limit]

    def average_response_time(self, limit=500):
        deltas = []
        for record in self.list_alert_acknowledgements(limit=limit):
            try:
                detected_at = float(record.detection_ref.rsplit(":", 1)[-1])
            except ValueError:
                continue
            deltas.append(record.acknowledged_at - detected_at)
        if not deltas:
            return AlertResponseTimeStats(average_seconds=None, sample_size=0)
        return AlertResponseTimeStats(average_seconds=sum(deltas) / len(deltas), sample_size=len(deltas))

    def record_motif_feedback(self, event):
        record = MotifFeedbackRecord(
            id=self._next_feedback_id, motif_name=event.motif_name, chain_key=event.chain_key,
            disposition=event.disposition, noted_at=event.noted_at, analyst=event.analyst,
        )
        self._next_feedback_id += 1
        self.feedback.append(record)

    def record_alert_acknowledgement(self, detection_type, detection_ref, analyst, notes, t):
        record = AlertAcknowledgementRecord(
            id=self._next_ack_id, detection_type=detection_type, detection_ref=detection_ref,
            acknowledged_by=analyst, acknowledged_at=t, notes=notes,
        )
        self._next_ack_id += 1
        self.acks.append(record)


class FakeForensicsApi:
    def __init__(self):
        self.records: list[PrunedEdgeRecord] = []
        self.by_id: dict = {}
        self.entities: list[str] = []

    def reconstruct_activity(self, entity_id, start, end):
        return self.records

    def get_edge(self, edge_id):
        return self.by_id.get(edge_id)

    def _entities_matching(self, type_prefix=None):
        return [e for e in self.entities if type_prefix is None or e.startswith(type_prefix)]

    def list_entities(self, type_prefix=None, limit=50, offset=0):
        return sorted(self._entities_matching(type_prefix))[offset:offset + limit]

    def count_entities(self, type_prefix=None):
        return len(self._entities_matching(type_prefix))


@pytest.fixture
def fake_state():
    return FakeApiState()


@pytest.fixture
def fake_forensics():
    return FakeForensicsApi()


@pytest.fixture
def client(fake_state, fake_forensics, tmp_path):
    audit_path = tmp_path / "audit.log"
    app.dependency_overrides[deps.audit_log_path] = lambda: audit_path
    # No file at this path until a test writes one -- matches the real
    # "pilot.py has never been run against this deployment" default.
    app.dependency_overrides[deps.pilot_report_path] = lambda: tmp_path / "pilot-report.json"
    app.dependency_overrides[deps.get_stream_config] = lambda: StreamConfig(poll_interval_seconds=0.0, max_iterations=1)
    app.dependency_overrides[deps.get_reader] = lambda: fake_state
    app.dependency_overrides[deps.get_writer] = lambda: fake_state
    app.dependency_overrides[deps.get_forensics_api] = lambda: fake_forensics
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def _edge(edge_id="e1"):
    return PrunedEdgeRecord(
        edge_id=edge_id, src="User:alice", dst="Machine:C1042", edge_type="Authentication",
        protocol="RDP", t_e=100.0, w_0=1.0, w_at_prune=0.2, pruned_at=200.0,
        source_system="test", raw_event_id=None,
    )


def test_metrics_snapshot_404_when_none_recorded(client):
    response = client.get("/api/metrics/snapshot")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == 404


def test_metrics_snapshot_returns_recorded_values(client, fake_state):
    fake_state.snapshot = MetricsSnapshot(
        active_graph_size=42, prune_rate_per_second=1.1, epsilon=0.3,
        motif_hit_rate_per_second=0.2, motif_reset_rate_per_second=0.1,
        latest_inference_latency_seconds=0.005, total_edges_processed=1000,
    )
    response = client.get("/api/metrics/snapshot")
    assert response.status_code == 200
    assert response.json() == {
        "active_graph_size": 42, "prune_rate_per_second": 1.1, "epsilon": 0.3,
        "motif_hit_rate_per_second": 0.2, "motif_reset_rate_per_second": 0.1,
        "latest_inference_latency_seconds": 0.005, "total_edges_processed": 1000,
    }


def test_entity_scores_paginated_envelope(client, fake_state):
    fake_state.scores = [InferenceResult(entity_id=f"User:u{i}", score=float(i), t=1.0, trigger="scheduled") for i in range(3)]
    response = client.get("/api/scores/entities?limit=2&offset=0")
    assert response.status_code == 200
    body = response.json()
    assert body["limit"] == 2
    assert body["offset"] == 0
    assert len(body["items"]) == 2
    assert body["items"][0]["entity_id"] == "User:u0"
    assert body["total"] is None  # F8.1: no start/end -- no COUNT(*) behind the default page


def test_entity_scores_start_end_filters_and_returns_exact_total(client, fake_state):
    fake_state.scores = [
        InferenceResult(entity_id="User:old", score=1.0, t=100.0, trigger="scheduled"),
        InferenceResult(entity_id="User:mid", score=2.0, t=200.0, trigger="scheduled"),
        InferenceResult(entity_id="User:new", score=3.0, t=300.0, trigger="scheduled"),
    ]
    response = client.get("/api/scores/entities?start=150&end=250")
    assert response.status_code == 200
    body = response.json()
    assert [item["entity_id"] for item in body["items"]] == ["User:mid"]
    assert body["total"] == 1  # F8.1: total is exact once a range is applied


def test_get_entity_score_found(client, fake_state):
    fake_state.scores = [InferenceResult(entity_id="User:alice", score=4.2, t=100.0, trigger="scheduled")]
    response = client.get("/api/scores/entities/User:alice")
    assert response.status_code == 200
    assert response.json()["score"] == 4.2


def test_get_entity_score_404_when_never_scored(client):
    response = client.get("/api/scores/entities/User:nobody")
    assert response.status_code == 404
    assert "User:nobody" in response.json()["error"]["message"]


def test_motif_completions_filter_by_name(client, fake_state):
    fake_state.completions = [
        MotifCompletionRecord(id=1, motif_name="lateral_pivot", chain_key="Machine:C1042", matched_edges=["e1"], completed_at=1.0, confidence=1.0),
        MotifCompletionRecord(id=2, motif_name="admin_share_escalation", chain_key="User:svc", matched_edges=["e2"], completed_at=2.0, confidence=0.8),
    ]
    response = client.get("/api/motifs/completions?motif_name=admin_share_escalation")
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["motif_name"] == "admin_share_escalation"
    assert response.json()["total"] is None  # F8.1: no start/end -- unfiltered stays uncounted


def test_motif_completions_start_end_filters_and_returns_exact_total(client, fake_state):
    fake_state.completions = [
        MotifCompletionRecord(id=1, motif_name="lateral_pivot", chain_key="Machine:C1", matched_edges=["e1"], completed_at=100.0, confidence=1.0),
        MotifCompletionRecord(id=2, motif_name="lateral_pivot", chain_key="Machine:C2", matched_edges=["e2"], completed_at=200.0, confidence=1.0),
        MotifCompletionRecord(id=3, motif_name="lateral_pivot", chain_key="Machine:C3", matched_edges=["e3"], completed_at=300.0, confidence=1.0),
    ]
    response = client.get("/api/motifs/completions?start=150&end=250")
    assert response.status_code == 200
    body = response.json()
    assert [item["chain_key"] for item in body["items"]] == ["Machine:C2"]
    assert body["total"] == 1  # F8.3's "number of attacks" needs this exact, not a page-bounded count


def test_motif_completions_filter_by_chain_key_returns_exact_total(client, fake_state):
    fake_state.completions = [
        MotifCompletionRecord(id=1, motif_name="lateral_pivot", chain_key="Machine:C1", matched_edges=["e1"], completed_at=1.0, confidence=1.0),
        MotifCompletionRecord(id=2, motif_name="lateral_pivot", chain_key="Machine:C2", matched_edges=["e2"], completed_at=2.0, confidence=1.0),
    ]
    response = client.get("/api/motifs/completions?chain_key=Machine:C1")
    assert response.status_code == 200
    body = response.json()
    assert [item["chain_key"] for item in body["items"]] == ["Machine:C1"]
    assert body["total"] == 1  # F10.5: a specific entity's full trigger history needs an exact count


def test_motif_resets_listing(client, fake_state):
    fake_state.resets = [
        MotifResetRecord(id=1, motif_name="lateral_pivot", chain_key="Machine:C1042", triggering_edge_id="e1", matched_edges=["e1"], reset_at=5.0),
    ]
    response = client.get("/api/motifs/resets")
    assert response.status_code == 200
    assert response.json()["items"][0]["triggering_edge_id"] == "e1"


def test_submit_and_list_motif_feedback(client):
    response = client.post("/api/motifs/feedback", json={
        "motif_name": "lateral_pivot", "chain_key": "Machine:C1042",
        "disposition": "true_positive", "analyst": "alice",
    })
    assert response.status_code == 201
    body = response.json()
    assert body["disposition"] == "true_positive"
    assert body["analyst"] == "alice"

    listing = client.get("/api/motifs/feedback")
    assert listing.status_code == 200
    assert len(listing.json()["items"]) == 1


def test_submit_motif_feedback_rejects_invalid_disposition(client):
    response = client.post("/api/motifs/feedback", json={
        "motif_name": "lateral_pivot", "chain_key": "Machine:C1042", "disposition": "maybe",
    })
    assert response.status_code == 422


def test_forensics_reconstruct_activity(client, fake_forensics):
    fake_forensics.records = [_edge("e1"), _edge("e2")]
    response = client.get("/api/forensics/entity/User:alice?start=0&end=1000")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_forensics_get_edge_found(client, fake_forensics):
    fake_forensics.by_id["e1"] = _edge("e1")
    response = client.get("/api/forensics/edge/e1")
    assert response.status_code == 200
    assert response.json()["edge_id"] == "e1"


def test_forensics_get_edge_not_found(client):
    response = client.get("/api/forensics/edge/nonexistent")
    assert response.status_code == 404
    assert "nonexistent" in response.json()["error"]["message"]


def test_list_entities_filters_by_type_prefix_and_sorts(client, fake_forensics):
    fake_forensics.entities = ["User:bob", "User:alice", "Machine:C1042"]
    response = client.get("/api/entities?type=User")
    assert response.status_code == 200
    body = response.json()
    assert body["items"] == ["User:alice", "User:bob"]
    assert body["total"] == 2


def test_list_entities_unfiltered_returns_every_type(client, fake_forensics):
    fake_forensics.entities = ["User:alice", "Machine:C1042"]
    response = client.get("/api/entities")
    assert response.status_code == 200
    assert response.json()["total"] == 2


def test_config_protocols_reads_real_registry(client):
    response = client.get("/api/config/protocols")
    assert response.status_code == 200
    names = {p["protocol"] for p in response.json()}
    assert {"RDP", "Kerberos", "SMB", "DNS"} <= names


def test_config_motifs_reads_real_registry(client):
    response = client.get("/api/config/motifs")
    assert response.status_code == 200
    names = {m["name"] for m in response.json()}
    assert {"lateral_pivot", "admin_share_escalation"} <= names


def test_acknowledge_alert(client, fake_state):
    response = client.post("/api/alerts/ack", json={
        "detection_type": "motif_completion", "detection_ref": "lateral_pivot:Machine:C1042:123.0",
        "analyst": "bob", "notes": "confirmed",
    })
    assert response.status_code == 201
    assert response.json()["acknowledged_by"] == "bob"
    assert len(fake_state.acks) == 1


def test_average_response_time_is_null_with_no_acks(client):
    response = client.get("/api/alerts/response-time")
    assert response.status_code == 200
    assert response.json() == {"average_seconds": None, "sample_size": 0}


def test_average_response_time_computed_from_detection_ref_timestamp(client, fake_state):
    # motif_completion ref embeds completed_at=100.0; acked 30s later.
    fake_state.acks.append(AlertAcknowledgementRecord(
        id=1, detection_type="motif_completion", detection_ref="lateral_pivot:Machine:C1042:100.0",
        acknowledged_by="bob", acknowledged_at=130.0, notes=None,
    ))

    response = client.get("/api/alerts/response-time")

    assert response.status_code == 200
    body = response.json()
    assert body["sample_size"] == 1
    assert body["average_seconds"] == pytest.approx(30.0)


def test_health_reports_degraded_when_a_dependency_is_down(client, monkeypatch):
    monkeypatch.setattr(deps, "postgres_reachable", lambda: True)
    monkeypatch.setattr(deps, "_neo4j_reachable", lambda config: False)
    monkeypatch.setattr(deps, "redis_reachable", lambda: True)
    monkeypatch.setattr(deps, "seconds_since_last_metrics_snapshot", lambda: 5.0)

    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["neo4j"] is False
    assert body["last_metrics_snapshot_age_seconds"] == 5.0


def test_health_reports_ok_when_everything_reachable(client, monkeypatch):
    monkeypatch.setattr(deps, "postgres_reachable", lambda: True)
    monkeypatch.setattr(deps, "_neo4j_reachable", lambda config: True)
    monkeypatch.setattr(deps, "redis_reachable", lambda: True)
    monkeypatch.setattr(deps, "seconds_since_last_metrics_snapshot", lambda: 1.0)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


# --- F0.8: GET /api/audit/log -----------------------------------------------------


def test_audit_log_empty_when_file_missing(client):
    response = client.get("/api/audit/log")
    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 0


def test_audit_log_lists_newest_first(client, tmp_path):
    sink = FileAuditSink(tmp_path / "audit.log")
    sink.write({"type": "prune", "edge_id": "a", "logged_at": 1.0})
    sink.write({"type": "motif_reset", "chain_key": "k", "logged_at": 2.0})

    response = client.get("/api/audit/log")

    assert response.status_code == 200
    items = response.json()["items"]
    assert [i["type"] for i in items] == ["motif_reset", "prune"]


def test_audit_log_filters_by_type_and_since(client):
    sink = FileAuditSink(app.dependency_overrides[deps.audit_log_path]())
    sink.write({"type": "prune", "edge_id": "a", "logged_at": 1.0})
    sink.write({"type": "prune", "edge_id": "b", "logged_at": 5.0})
    sink.write({"type": "motif_reset", "chain_key": "k", "logged_at": 5.0})

    response = client.get("/api/audit/log?type=prune&since=2.0")

    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["edge_id"] == "b"


def test_audit_log_paginates(client):
    sink = FileAuditSink(app.dependency_overrides[deps.audit_log_path]())
    for i in range(5):
        sink.write({"type": "prune", "edge_id": f"e{i}", "logged_at": float(i)})

    response = client.get("/api/audit/log?limit=2&offset=0")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 5
    assert len(body["items"]) == 2
    assert body["items"][0]["edge_id"] == "e4"


def test_audit_log_filters_by_until(client):
    sink = FileAuditSink(app.dependency_overrides[deps.audit_log_path]())
    sink.write({"type": "prune", "edge_id": "a", "logged_at": 1.0})
    sink.write({"type": "prune", "edge_id": "b", "logged_at": 5.0})

    response = client.get("/api/audit/log?until=2.0")

    items = response.json()["items"]
    assert [i["edge_id"] for i in items] == ["a"]


def test_audit_log_filters_by_entity(client):
    sink = FileAuditSink(app.dependency_overrides[deps.audit_log_path]())
    sink.write({"type": "prune", "edge_id": "a", "src": "User:alice", "dst": "Machine:C1", "logged_at": 1.0})
    sink.write({"type": "prune", "edge_id": "b", "src": "User:bob", "dst": "Machine:C2", "logged_at": 2.0})

    response = client.get("/api/audit/log?entity=User:alice")

    items = response.json()["items"]
    assert [i["edge_id"] for i in items] == ["a"]


def test_audit_log_filters_by_freetext_query(client):
    sink = FileAuditSink(app.dependency_overrides[deps.audit_log_path]())
    sink.write({"type": "motif_reset", "chain_key": "lateral_pivot_chain", "logged_at": 1.0})
    sink.write({"type": "motif_reset", "chain_key": "other_chain", "logged_at": 2.0})

    response = client.get("/api/audit/log?q=lateral")

    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["chain_key"] == "lateral_pivot_chain"


# --- F8.4: GET /api/pilot/latest-report --------------------------------------------


def test_pilot_report_404_when_none_recorded(client):
    response = client.get("/api/pilot/latest-report")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == 404


def test_pilot_report_returns_recorded_values(client, tmp_path):
    report_path = tmp_path / "pilot-report.json"
    report_path.write_text(
        json.dumps({
            "anomaly": {"true_positives": 3, "false_positives": 1, "false_negatives": 0, "precision": 0.75, "recall": 1.0},
            "motif": {"true_positives": 2, "false_positives": 0, "false_negatives": 1, "precision": 1.0, "recall": 0.6667},
        }),
        encoding="utf-8",
    )

    response = client.get("/api/pilot/latest-report")

    assert response.status_code == 200
    body = response.json()
    assert body["anomaly"]["precision"] == 0.75
    assert body["motif"]["recall"] == 0.6667
    assert isinstance(body["evaluated_at"], float)


# --- F0.10: GET /api/stream/events -------------------------------------------------


def _parse_sse(text):
    events = []
    for block in text.strip().split("\n\n"):
        if not block.strip():
            continue
        lines = block.splitlines()
        event = next(line.split(": ", 1)[1] for line in lines if line.startswith("event: "))
        data = next(line.split(": ", 1)[1] for line in lines if line.startswith("data: "))
        events.append((event, json.loads(data)))
    return events


def test_stream_events_emits_pending_motif_completion_and_heartbeat(client, fake_state):
    fake_state.completions = [
        MotifCompletionRecord(id=1, motif_name="lateral_pivot", chain_key="Machine:C1042", matched_edges=["e1"], completed_at=1.0, confidence=1.0),
    ]

    response = client.get("/api/stream/events")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse(response.text)
    types = [e for e, _ in events]
    assert "motif_completion" in types
    assert "heartbeat" in types
    completion = next(payload for e, payload in events if e == "motif_completion")
    assert completion["motif_name"] == "lateral_pivot"


def test_stream_events_emits_pending_prune_from_audit_log(client):
    sink = FileAuditSink(app.dependency_overrides[deps.audit_log_path]())
    sink.write({"type": "prune", "edge_id": "e1", "src": "User:a", "dst": "Machine:b", "logged_at": time.time() + 10})

    response = client.get("/api/stream/events")

    events = _parse_sse(response.text)
    prune_events = [payload for e, payload in events if e == "prune"]
    assert len(prune_events) == 1
    assert prune_events[0]["edge_id"] == "e1"


def test_stream_events_emits_entity_score_update(client, fake_state):
    fake_state.score_updates = [
        EntityScoreUpdate(result=InferenceResult(entity_id="User:alice", score=3.5, t=1.0, trigger="scheduled"), updated_at=time.time()),
    ]

    response = client.get("/api/stream/events")

    events = _parse_sse(response.text)
    scores = [payload for e, payload in events if e == "inference_result"]
    assert len(scores) == 1
    assert scores[0]["entity_id"] == "User:alice"
