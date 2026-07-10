import json
from pathlib import Path

from t_gnn.data.stage_lanl import infer_protocol, infer_w0, stage

FIXTURE = Path(__file__).resolve().parents[1] / "data" / "lanl" / "raw" / "sample_auth.txt.gz"


def test_infer_protocol_remote_interactive_is_rdp():
    assert infer_protocol("Negotiate", "RemoteInteractive") == "RDP"


def test_infer_protocol_kerberos_stays_kerberos():
    assert infer_protocol("Kerberos", "Network") == "Kerberos"


def test_infer_protocol_network_ntlm_falls_back_to_smb():
    assert infer_protocol("Negotiate", "Network") == "SMB"


def test_infer_w0_downweights_failures():
    assert infer_w0("Success") == 1.0
    assert infer_w0("Fail") < 1.0


def test_stage_produces_valid_edges(tmp_path):
    out_dir = tmp_path / "staged"
    stats = stage(FIXTURE, out_dir, epoch_start=1_000_000_000, shard_size=1000)

    assert stats.lines_read == 5
    assert stats.edges_written == 5
    assert stats.lines_skipped == 0
    assert stats.shards_written == 1

    shard = out_dir / "shard-00000.jsonl"
    assert shard.exists()
    lines = shard.read_text().strip().splitlines()
    assert len(lines) == 5

    edges = [json.loads(line) for line in lines]
    for edge in edges:
        assert edge["src"].startswith("User:")
        assert edge["dst"].startswith("Machine:")
        assert edge["edge_type"] == "Authentication"
        assert edge["protocol"] in ("RDP", "SMB", "Kerberos", "DNS")
        assert edge["t_e"] >= 1_000_000_000

    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert manifest["edges_written"] == 5
    assert manifest["source_sha256"]


def test_stage_shards_by_size(tmp_path):
    out_dir = tmp_path / "staged"
    stats = stage(FIXTURE, out_dir, epoch_start=1_000_000_000, shard_size=2)

    assert stats.shards_written == 3  # 5 edges / shard_size 2 -> 3 shards
    assert sorted(p.name for p in out_dir.glob("shard-*.jsonl")) == [
        "shard-00000.jsonl",
        "shard-00001.jsonl",
        "shard-00002.jsonl",
    ]
