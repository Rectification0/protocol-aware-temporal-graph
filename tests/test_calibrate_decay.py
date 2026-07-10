from pathlib import Path

from t_gnn.data.calibrate_decay import calibrate, gaps_by_protocol, load_staged_edges
from t_gnn.data.stage_lanl import stage
from t_gnn.protocol_registry import ProtocolDecayRegistry
from t_gnn.schema import Edge

FIXTURE = Path(__file__).resolve().parents[1] / "data" / "lanl" / "raw" / "sample_auth.txt.gz"


def test_gaps_by_protocol_collects_same_entity_consecutive_gaps():
    edges = [
        Edge(src="User:alice", dst="Machine:C1", edge_type="Authentication", protocol="RDP", t_e=0.0, w_0=1.0),
        Edge(src="User:alice", dst="Machine:C2", edge_type="Authentication", protocol="RDP", t_e=100.0, w_0=1.0),
        Edge(src="User:bob", dst="Machine:C3", edge_type="Authentication", protocol="SMB", t_e=50.0, w_0=1.0),
    ]
    gaps = gaps_by_protocol(edges)
    assert gaps["RDP"] == [100.0]
    assert "SMB" not in gaps  # bob has only one SMB edge -- no gap to compute


def test_calibrate_falls_back_to_current_default_with_insufficient_samples(tmp_path):
    out_dir = tmp_path / "staged"
    stage(FIXTURE, out_dir, epoch_start=1_000_000_000, shard_size=1000)

    registry = ProtocolDecayRegistry()
    results = calibrate(out_dir, registry=registry, min_samples=30)

    protocols_seen = {r.protocol for r in results}
    assert protocols_seen == set(registry.protocols)
    for result in results:
        # The tiny synthetic fixture (5 rows) can't produce 30 same-entity
        # consecutive-gap samples for any protocol -- calibration should
        # recognize this and defer to the existing expert-default lambda_p
        # rather than emit an unreliable suggestion (tasks.md 1.7).
        assert not result.sufficient_data
        assert result.suggested_lambda_p is None
        assert result.current_lambda_p == registry.lambda_for(result.protocol)


def test_load_staged_edges_round_trips_shard_contents(tmp_path):
    out_dir = tmp_path / "staged"
    stats = stage(FIXTURE, out_dir, epoch_start=1_000_000_000, shard_size=1000)

    edges = load_staged_edges(out_dir)
    assert len(edges) == stats.edges_written


def test_calibrate_suggests_lambda_from_synthetic_gaps(tmp_path):
    # Build a synthetic staged shard directly (bypassing the tiny real
    # fixture) with enough same-entity RDP gaps to cross min_samples and
    # exercise the actual suggestion path.
    out_dir = tmp_path / "staged"
    out_dir.mkdir(parents=True)
    with open(out_dir / "shard-00000.jsonl", "w", encoding="utf-8") as f:
        for i in range(40):
            edge = Edge(
                src="User:alice",
                dst="Machine:C1042",
                edge_type="Authentication",
                protocol="RDP",
                t_e=float(i) * 3600.0,  # one RDP session per hour
                w_0=1.0,
            )
            f.write(edge.to_json() + "\n")

    results = calibrate(out_dir, min_samples=30)
    rdp_result = next(r for r in results if r.protocol == "RDP")

    assert rdp_result.sufficient_data
    assert rdp_result.sample_count == 39
    assert rdp_result.median_gap_seconds == 3600.0
    assert rdp_result.suggested_lambda_p is not None
    assert rdp_result.suggested_half_life_hours == 1.0
