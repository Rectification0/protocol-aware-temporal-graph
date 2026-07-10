import jsonschema
import pytest

from t_gnn.schema import Edge, make_edge_id


def make_valid_edge(**overrides):
    defaults = dict(
        src="User:alice",
        dst="Machine:C1042",
        edge_type="Authentication",
        protocol="Kerberos",
        t_e=1_700_000_000.0,
        w_0=1.0,
    )
    defaults.update(overrides)
    return Edge(**defaults)


def test_edge_id_is_deterministic():
    a = make_edge_id("User:alice", "Machine:C1042", "Kerberos", 100.0)
    b = make_edge_id("User:alice", "Machine:C1042", "Kerberos", 100.0)
    c = make_edge_id("User:alice", "Machine:C1042", "Kerberos", 101.0)
    assert a == b
    assert a != c


def test_node_type_inferred_from_id_prefix():
    edge = make_valid_edge()
    assert edge.src_type == "User"
    assert edge.dst_type == "Machine"


def test_edge_validates_against_json_schema():
    edge = make_valid_edge()
    edge.validate()  # should not raise


def test_edge_rejects_unknown_protocol():
    edge = make_valid_edge(protocol="Telnet")
    with pytest.raises(jsonschema.ValidationError):
        edge.validate()


def test_edge_rejects_unknown_edge_type():
    edge = make_valid_edge(edge_type="Lateral")
    with pytest.raises(jsonschema.ValidationError):
        edge.validate()


def test_round_trip_json():
    edge = make_valid_edge(source_system="sysmon", raw_event_id="4624")
    restored = Edge.from_json(edge.to_json())
    assert restored == edge
