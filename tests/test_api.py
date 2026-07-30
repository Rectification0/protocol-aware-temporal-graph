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

import pytest
from fastapi.testclient import TestClient

from t_gnn.api import deps
from t_gnn.api.app import app
from t_gnn.api_state import AlertAcknowledgementRecord, MotifCompletionRecord, MotifFeedbackRecord, MotifResetRecord
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
        self.feedback: list[MotifFeedbackRecord] = []
        self.acks: list[AlertAcknowledgementRecord] = []
        self._next_feedback_id = 1
        self._next_ack_id = 1

    def latest_metrics_snapshot(self):
        return self.snapshot

    def list_entity_scores(self, limit=50, offset=0):
        return self.scores[offset:offset + limit]

    def list_motif_completions(self, limit=50, offset=0, motif_name=None):
        items = [c for c in self.completions if motif_name is None or c.motif_name == motif_name]
        return items[offset:offset + limit]

    def list_motif_resets(self, limit=50, offset=0):
        return self.resets[offset:offset + limit]

    def list_motif_feedback(self, limit=50, offset=0):
        return list(reversed(self.feedback))[offset:offset + limit]

    def list_alert_acknowledgements(self, limit=50, offset=0):
        return list(reversed(self.acks))[offset:offset + limit]

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

    def reconstruct_activity(self, entity_id, start, end):
        return self.records

    def get_edge(self, edge_id):
        return self.by_id.get(edge_id)


@pytest.fixture
def fake_state():
    return FakeApiState()


@pytest.fixture
def fake_forensics():
    return FakeForensicsApi()


@pytest.fixture
def client(fake_state, fake_forensics):
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
        latest_inference_latency_seconds=0.005,
    )
    response = client.get("/api/metrics/snapshot")
    assert response.status_code == 200
    assert response.json() == {
        "active_graph_size": 42, "prune_rate_per_second": 1.1, "epsilon": 0.3,
        "motif_hit_rate_per_second": 0.2, "motif_reset_rate_per_second": 0.1,
        "latest_inference_latency_seconds": 0.005,
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
