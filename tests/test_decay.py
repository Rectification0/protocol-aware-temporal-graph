import math

from t_gnn.decay import DecayEngine, compute_weight
from t_gnn.protocol_registry import ProtocolDecayRegistry
from t_gnn.schema import Edge


def test_weight_at_t_e_equals_w0():
    assert compute_weight(w_0=1.0, lambda_p=0.001, t_e=1000.0, t=1000.0) == 1.0


def test_weight_decreases_over_time():
    early = compute_weight(w_0=1.0, lambda_p=0.001, t_e=0.0, t=10.0)
    late = compute_weight(w_0=1.0, lambda_p=0.001, t_e=0.0, t=100.0)
    assert late < early


def test_negative_elapsed_is_clamped_not_amplified():
    # Evaluating "before" t_e should not produce w(e,t) > w_0.
    assert compute_weight(w_0=1.0, lambda_p=0.001, t_e=1000.0, t=0.0) == 1.0


def test_rdp_decays_faster_than_smb_under_identical_elapsed_time():
    # specs.md P2 / tasks.md 1.6: RDP sessions are short-lived, SMB shares
    # are routinely left open far longer -- RDP's weight should drop below
    # SMB's given the same elapsed (t - t_e).
    registry = ProtocolDecayRegistry()
    elapsed = 3600.0 * 5  # 5 hours
    rdp_weight = compute_weight(1.0, registry.lambda_for("RDP"), 0.0, elapsed)
    smb_weight = compute_weight(1.0, registry.lambda_for("SMB"), 0.0, elapsed)
    assert rdp_weight < smb_weight


def test_kerberos_decays_faster_than_dns_under_identical_elapsed_time():
    registry = ProtocolDecayRegistry()
    elapsed = 3600.0 * 20
    kerberos_weight = compute_weight(1.0, registry.lambda_for("Kerberos"), 0.0, elapsed)
    dns_weight = compute_weight(1.0, registry.lambda_for("DNS"), 0.0, elapsed)
    assert kerberos_weight < dns_weight


def test_decay_matches_closed_form_exponential():
    w = compute_weight(w_0=2.0, lambda_p=0.01, t_e=5.0, t=15.0)
    assert w == 2.0 * math.exp(-0.01 * 10.0)


def test_decay_engine_refresh_updates_weight_and_timestamp():
    edge = Edge(src="User:alice", dst="Machine:C1042", edge_type="Authentication", protocol="RDP", t_e=1000.0, w_0=1.0)
    engine = DecayEngine()

    refreshed = engine.refresh(edge, t=1000.0 + 3600.0)

    assert refreshed.w is not None
    assert refreshed.w < 1.0
    assert refreshed.w_evaluated_at == 1000.0 + 3600.0
    # Original edge is untouched; refresh returns a copy.
    assert edge.w is None


def test_decay_engine_uses_supplied_registry():
    registry = ProtocolDecayRegistry()
    engine = DecayEngine(registry=registry)
    assert engine.registry is registry


def test_decay_engine_weight_at_matches_compute_weight():
    registry = ProtocolDecayRegistry()
    edge = Edge(src="Machine:C1", dst="Machine:C2", edge_type="Authentication", protocol="SMB", t_e=0.0, w_0=1.0)
    engine = DecayEngine(registry=registry)

    expected = compute_weight(1.0, registry.lambda_for("SMB"), 0.0, 500.0)
    assert engine.weight_at(edge, 500.0) == expected
