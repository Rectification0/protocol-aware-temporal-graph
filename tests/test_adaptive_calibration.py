"""Tests for continuous/adaptive lambda_p calibration (tasks.md Backlog B.3)."""

import math

from t_gnn.adaptive_calibration import AdaptiveDecayCalibrator
from t_gnn.protocol_registry import ProtocolDecayRegistry
from t_gnn.schema import Edge


def _edge(src, t_e, protocol="RDP"):
    return Edge(src=src, dst="Machine:C1", edge_type="Authentication", protocol=protocol, t_e=t_e, w_0=1.0)


def _registry(tmp_path, lambda_p=0.001):
    config_path = tmp_path / "protocols.yaml"
    config_path.write_text(
        "default_lambda_p: 0.0001\n"
        "protocols:\n"
        f"  RDP:\n    lambda_p: {lambda_p}\n",
        encoding="utf-8",
    )
    return ProtocolDecayRegistry(config_path=config_path)


def test_update_overwrites_lambda_in_memory_without_touching_disk(tmp_path):
    registry = _registry(tmp_path, lambda_p=0.001)
    registry.update("RDP", 0.5)
    assert registry.lambda_for("RDP") == 0.5

    registry.reload()  # disk untouched -- reload restores the file's original value
    assert registry.lambda_for("RDP") == 0.001


def test_update_preserves_half_life_and_description_metadata(tmp_path):
    config_path = tmp_path / "protocols.yaml"
    config_path.write_text(
        "default_lambda_p: 0.0001\n"
        "protocols:\n"
        "  RDP:\n"
        "    lambda_p: 0.001\n"
        "    half_life_hours: 1.5\n"
        "    description: test protocol\n",
        encoding="utf-8",
    )
    registry = ProtocolDecayRegistry(config_path=config_path)
    registry.update("RDP", 0.5)
    cfg = registry.get("RDP")
    assert cfg.lambda_p == 0.5
    assert cfg.half_life_hours == 1.5
    assert cfg.description == "test protocol"


def test_no_recalibration_below_min_samples(tmp_path):
    registry = _registry(tmp_path)
    calibrator = AdaptiveDecayCalibrator(registry=registry, min_samples=30, update_interval_edges=5)

    t = 0.0
    for i in range(10):
        events = calibrator.observe(_edge(src="User:alice", t_e=t))
        assert events == []
        t += 100.0

    assert registry.lambda_for("RDP") == 0.001  # untouched -- too few gap samples


def test_recalibration_applies_suggested_lambda_once_enough_samples(tmp_path):
    registry = _registry(tmp_path, lambda_p=0.001)
    calibrator = AdaptiveDecayCalibrator(
        registry=registry, min_samples=20, update_interval_edges=40, max_relative_change=10.0,
    )

    # 41 same-entity RDP edges, each 3600s apart -> 40 gaps of 3600s each,
    # so the true median gap is exactly 3600s regardless of window ordering.
    t = 0.0
    all_events = []
    for _ in range(41):
        all_events.extend(calibrator.observe(_edge(src="User:alice", t_e=t)))
        t += 3600.0

    assert len(all_events) == 1
    event = all_events[0]
    assert event.protocol == "RDP"
    assert event.sample_count == 39
    expected_lambda = math.log(2) / 3600.0
    assert math.isclose(event.suggested_lambda_p, expected_lambda, rel_tol=1e-9)
    assert math.isclose(event.applied_lambda_p, expected_lambda, rel_tol=1e-9)
    assert registry.lambda_for("RDP") == event.applied_lambda_p


def test_max_relative_change_clamps_a_large_jump(tmp_path):
    registry = _registry(tmp_path, lambda_p=0.001)
    calibrator = AdaptiveDecayCalibrator(
        registry=registry, min_samples=20, update_interval_edges=40, max_relative_change=0.1,
    )

    # Same as above -- true suggested lambda is far from the registry's
    # current 0.001, so the 10% clamp should bind.
    t = 0.0
    all_events = []
    for _ in range(41):
        all_events.extend(calibrator.observe(_edge(src="User:alice", t_e=t)))
        t += 3600.0

    assert len(all_events) == 1
    event = all_events[0]
    # 3600s gaps suggest a *smaller* lambda_p (slower decay) than the
    # registry's current 0.001 -- the clamp should bind at the lower bound.
    lower_bound = 0.001 * 0.9
    assert math.isclose(event.applied_lambda_p, lower_bound, rel_tol=1e-9)
    assert event.suggested_lambda_p < event.applied_lambda_p  # the clamp actually bound something


def test_gaps_are_tracked_per_protocol_independently(tmp_path):
    config_path = tmp_path / "protocols.yaml"
    config_path.write_text(
        "default_lambda_p: 0.0001\n"
        "protocols:\n"
        "  RDP:\n    lambda_p: 0.001\n"
        "  SMB:\n    lambda_p: 0.001\n",
        encoding="utf-8",
    )
    registry = ProtocolDecayRegistry(config_path=config_path)
    calibrator = AdaptiveDecayCalibrator(
        registry=registry, min_samples=5, update_interval_edges=100, max_relative_change=10.0,
    )

    t = 0.0
    for _ in range(20):
        calibrator.observe(_edge(src="User:alice", t_e=t, protocol="RDP"))
        t += 60.0  # RDP: 60s gaps
    for _ in range(20):
        calibrator.observe(_edge(src="User:bob", t_e=t, protocol="SMB"))
        t += 7200.0  # SMB: 7200s gaps

    events = calibrator._recalibrate(t=t)
    by_protocol = {e.protocol: e for e in events}
    assert math.isclose(by_protocol["RDP"].suggested_lambda_p, math.log(2) / 60.0, rel_tol=1e-9)
    assert math.isclose(by_protocol["SMB"].suggested_lambda_p, math.log(2) / 7200.0, rel_tol=1e-9)
    assert by_protocol["RDP"].suggested_lambda_p > by_protocol["SMB"].suggested_lambda_p
