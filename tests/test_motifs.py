import jsonschema
import pytest

from t_gnn.motifs import HostAdminKeyResolver, IdentityKeyResolver, MotifRegistry, MotifStep
from t_gnn.schema import Edge


def _edge(src="Machine:A", dst="Machine:B", edge_type="Authentication", protocol="Kerberos", t_e=0.0):
    return Edge(src=src, dst=dst, edge_type=edge_type, protocol=protocol, t_e=t_e, w_0=1.0)


# --- MotifRegistry loads + validates config/motifs.yaml (3.1) ------------------


def test_registry_loads_seed_motifs():
    registry = MotifRegistry()
    assert "admin_share_escalation" in registry.names
    assert "lateral_pivot" in registry.names


def test_lateral_pivot_shape_and_window():
    registry = MotifRegistry()
    motif = registry.get("lateral_pivot")

    assert motif.window_seconds == 14400
    assert len(motif.steps) == 2
    assert motif.steps[0].src_type == frozenset({"Machine"})
    assert motif.steps[0].dst_type == frozenset({"Machine"})
    assert motif.steps[1].edge_type == frozenset({"Authentication", "RemoteCodeExecution"})
    assert motif.steps[1].key_resolver == "host_admin"


def test_registry_rejects_definition_violating_schema(tmp_path):
    bad_config = tmp_path / "motifs.yaml"
    bad_config.write_text(
        "motifs:\n"
        "  broken:\n"
        "    window_seconds: 60\n"
        "    steps:\n"
        "      - key_field: sideways\n",  # invalid enum value
        encoding="utf-8",
    )
    with pytest.raises(jsonschema.ValidationError):
        MotifRegistry(config_path=bad_config)


def test_registry_reload_picks_up_changes(tmp_path):
    config = tmp_path / "motifs.yaml"
    config.write_text(
        "motifs:\n"
        "  probe:\n"
        "    window_seconds: 60\n"
        "    steps:\n"
        "      - key_field: dst\n",
        encoding="utf-8",
    )
    registry = MotifRegistry(config_path=config)
    assert registry.names == ("probe",)

    config.write_text(
        "motifs:\n"
        "  probe:\n"
        "    window_seconds: 120\n"
        "    steps:\n"
        "      - key_field: dst\n"
        "  extra:\n"
        "    window_seconds: 30\n"
        "    steps:\n"
        "      - key_field: src\n",
        encoding="utf-8",
    )
    registry.reload()
    assert set(registry.names) == {"probe", "extra"}
    assert registry.get("probe").window_seconds == 120


# --- MotifStep shape matching ----------------------------------------------------


def test_matches_shape_respects_type_and_protocol_filters():
    step = MotifStep(key_field="dst", edge_type=frozenset({"Authentication"}), protocol=frozenset({"RDP"}))
    assert step.matches_shape(_edge(edge_type="Authentication", protocol="RDP"))
    assert not step.matches_shape(_edge(edge_type="Authentication", protocol="SMB"))
    assert not step.matches_shape(_edge(edge_type="FileTransfer", protocol="RDP"))


def test_matches_shape_with_no_filters_matches_anything():
    step = MotifStep(key_field="src")
    assert step.matches_shape(_edge(edge_type="RemoteCodeExecution", protocol="DNS"))


def test_matches_shape_accepts_multi_value_edge_type():
    step = MotifStep(key_field="src", edge_type=frozenset({"Authentication", "RemoteCodeExecution"}))
    assert step.matches_shape(_edge(edge_type="Authentication"))
    assert step.matches_shape(_edge(edge_type="RemoteCodeExecution"))
    assert not step.matches_shape(_edge(edge_type="FileTransfer"))


# --- KeyResolvers ------------------------------------------------------------------


def test_identity_key_resolver_returns_node_id_unchanged():
    assert IdentityKeyResolver().candidate_key("Machine:C1042") == "Machine:C1042"


def test_host_admin_key_resolver_extracts_machine_name_from_admin_account():
    resolver = HostAdminKeyResolver()
    assert resolver.candidate_key("User:C1042-admin") == "Machine:C1042"
    assert resolver.candidate_key("User:C1042$") == "Machine:C1042"


def test_host_admin_key_resolver_none_for_empty_name():
    assert HostAdminKeyResolver().candidate_key("User:") is None


def test_step_candidate_key_uses_configured_resolver_and_field():
    step = MotifStep(key_field="src", key_resolver="host_admin")
    edge = _edge(src="User:C1042-svc", dst="Machine:C9999", edge_type="RemoteCodeExecution")
    assert step.candidate_key(edge) == "Machine:C1042"
