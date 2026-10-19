"""Frontend Backlog FB.1: the config write endpoints (`api/routers/config.py`)
-- the off-by-default gate, the audit-before-write rule, error mapping, and
that a write is visible to the API's own reads immediately. Real
`ConfigWriter`/registries over temp copies of config/*.yaml; Postgres faked.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from t_gnn.api import deps
from t_gnn.api.app import app
from t_gnn.api_state import ConfigChangeRecord
from t_gnn.config_writer import ConfigWriter
from t_gnn.motifs import MotifRegistry
from t_gnn.protocol_registry import ProtocolDecayRegistry

REPO = Path(__file__).resolve().parents[1]


class FakeAuditState:
    def __init__(self):
        self.reachable = True
        self.changes: list[ConfigChangeRecord] = []

    def ping(self):
        return self.reachable

    def record_config_change(self, kind, target, field, old_value, new_value, analyst, t):
        self.changes.append(
            ConfigChangeRecord(
                id=len(self.changes) + 1, kind=kind, target=target, field=field,
                old_value=old_value, new_value=new_value, changed_by=analyst, changed_at=t,
            )
        )
        return self.reachable

    def list_config_changes(self, limit=50, offset=0):
        return list(reversed(self.changes))[offset:offset + limit]


@pytest.fixture
def setup(tmp_path):
    protocols = tmp_path / "protocols.yaml"
    motifs = tmp_path / "motifs.yaml"
    shutil.copy(REPO / "config" / "protocols.yaml", protocols)
    shutil.copy(REPO / "config" / "motifs.yaml", motifs)
    state = FakeAuditState()
    protocol_registry = ProtocolDecayRegistry(protocols)
    motif_registry = MotifRegistry(motifs)
    flags = {"enabled": True}

    app.dependency_overrides[deps.config_writes_enabled] = lambda: flags["enabled"]
    app.dependency_overrides[deps.get_config_writer] = lambda: ConfigWriter(protocols, motifs)
    app.dependency_overrides[deps.get_writer] = lambda: state
    app.dependency_overrides[deps.get_reader] = lambda: state
    app.dependency_overrides[deps.get_protocol_registry] = lambda: protocol_registry
    app.dependency_overrides[deps.get_motif_registry] = lambda: motif_registry
    try:
        yield TestClient(app), state, flags, protocols, motifs
    finally:
        app.dependency_overrides.clear()


def test_capabilities_report_the_gate_and_bounds(setup):
    client, _, flags, *_ = setup
    flags["enabled"] = False
    body = client.get("/api/config/capabilities").json()
    assert body["writes_enabled"] is False
    assert 0 < body["min_lambda_p"] < body["max_lambda_p"]
    assert body["min_window_seconds"] == 60


def test_writes_are_refused_while_disabled_and_nothing_changes(setup):
    client, state, flags, protocols, _ = setup
    flags["enabled"] = False
    before = protocols.read_bytes()

    response = client.put("/api/config/protocols/SMB", json={"lambda_p": 0.00002, "analyst": "alice"})

    assert response.status_code == 403
    assert "API_CONFIG_WRITES_ENABLED" in response.json()["error"]["message"]
    assert protocols.read_bytes() == before and state.changes == []


def test_protocol_write_applies_audits_and_is_visible_to_reads(setup):
    client, state, _, protocols, _ = setup

    response = client.put("/api/config/protocols/SMB", json={"lambda_p": 0.00002, "analyst": "alice"})

    assert response.status_code == 200
    assert response.json() | {"changed_at": None} == {
        "id": None, "kind": "protocol", "target": "SMB", "field": "lambda_p",
        "old_value": 0.000004, "new_value": 0.00002, "changed_by": "alice", "changed_at": None,
    }
    assert ProtocolDecayRegistry(protocols).lambda_for("SMB") == 0.00002
    smb = next(p for p in client.get("/api/config/protocols").json() if p["protocol"] == "SMB")
    assert smb["lambda_p"] == 0.00002  # the API's cached registry reloaded
    assert [(c.target, c.changed_by) for c in state.changes] == [("SMB", "alice")]


def test_motif_write_and_change_history(setup):
    client, _, _, _, motifs = setup

    assert client.put("/api/config/motifs/lateral_pivot", json={"window_seconds": 7200, "analyst": "bob"}).status_code == 200
    assert client.put("/api/config/motifs/lateral_pivot", json={"window_seconds": 5400, "analyst": "bob"}).status_code == 200

    assert MotifRegistry(motifs).get("lateral_pivot").window_seconds == 5400
    history = client.get("/api/config/changes").json()["items"]
    assert [(h["old_value"], h["new_value"]) for h in history] == [(7200, 5400), (14400, 7200)]


def test_refuses_an_unauditable_change(setup):
    client, state, _, protocols, _ = setup
    state.reachable = False
    before = protocols.read_bytes()

    response = client.put("/api/config/protocols/SMB", json={"lambda_p": 0.00002, "analyst": "alice"})

    assert response.status_code == 503
    assert protocols.read_bytes() == before


@pytest.mark.parametrize(
    "path, body, status",
    [
        ("/api/config/protocols/SMB", {"lambda_p": -1}, 422),
        ("/api/config/protocols/FTP", {"lambda_p": 0.00002}, 404),
        ("/api/config/motifs/lateral_pivot", {"window_seconds": 10}, 422),
        ("/api/config/motifs/no_such_motif", {"window_seconds": 7200}, 404),
    ],
)
def test_error_mapping_uses_the_standard_envelope(setup, path, body, status):
    client, state, *_ = setup
    response = client.put(path, json=body)
    assert response.status_code == status
    assert set(response.json()["error"]) == {"code", "message"}
    assert state.changes == []
