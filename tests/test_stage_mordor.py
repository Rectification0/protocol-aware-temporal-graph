import json
from pathlib import Path

from t_gnn.data.stage_mordor import normalize, parse_mordor_stream, stage

FIXTURE = Path(__file__).resolve().parents[1] / "data" / "mordor" / "raw" / "sample_mordor.json"


def test_normalize_maps_hostname_to_computer():
    raw = {"Hostname": "FILESERVER1.contoso.local"}
    assert normalize(raw)["Computer"] == "FILESERVER1.contoso.local"


def test_normalize_leaves_existing_computer_field_untouched():
    raw = {"Hostname": "FILESERVER1.contoso.local", "Computer": "OVERRIDE"}
    assert normalize(raw)["Computer"] == "OVERRIDE"


def test_normalize_converts_iso_timestamp_to_epoch_seconds():
    raw = {"@timestamp": "2021-05-04T10:00:00.000Z"}
    normalized = normalize(raw)
    assert isinstance(normalized["TimeCreated"], float)
    assert normalized["TimeCreated"] > 1_600_000_000  # sane epoch-seconds ballpark


def test_normalize_handles_missing_timestamp_gracefully():
    raw = {"Hostname": "X"}
    normalized = normalize(raw)
    assert "TimeCreated" not in normalized


def test_parse_mordor_stream_classifies_each_fixture_line():
    lines = FIXTURE.read_text(encoding="utf-8").splitlines()
    results = list(parse_mordor_stream(iter(lines)))

    statuses = [status for _edge, status in results]
    assert statuses.count("ok") == 6
    assert statuses.count("unsupported") == 1  # Sysmon EventID 22 (DNS query) has no mapping
    assert statuses.count("skipped") == 2  # incomplete 4625 record + one malformed JSON line

    edges = [edge for edge, status in results if status == "ok"]
    assert all(e.src.startswith(("User:", "Machine:")) for e in edges)
    assert all(e.dst.startswith("Machine:") for e in edges)
    assert {e.edge_type for e in edges} == {"Authentication", "FileTransfer", "RemoteCodeExecution"}


def test_stage_produces_valid_edges_from_the_sample_fixture(tmp_path):
    out_dir = tmp_path / "staged"
    stats = stage(FIXTURE, out_dir, shard_size=1000)

    assert stats.lines_read == 9
    assert stats.edges_written == 6
    assert stats.lines_skipped == 2
    assert stats.lines_unsupported == 1
    assert stats.shards_written == 1

    shard = out_dir / "shard-00000.jsonl"
    lines = shard.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 6

    edges = [json.loads(line) for line in lines]
    for edge in edges:
        assert edge["protocol"] in ("RDP", "SMB", "Kerberos", "DNS")
        assert edge["source_system"] == "sysmon"
        assert edge["t_e"] > 1_600_000_000

    manifest = json.loads((out_dir / "manifest.json").read_text())
    assert manifest["edges_written"] == 6
    assert manifest["lines_unsupported"] == 1
    assert manifest["source_sha256"]


def test_stage_reads_a_zip_archive(tmp_path):
    import zipfile

    zip_path = tmp_path / "sample.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.write(FIXTURE, arcname="sample_mordor.json")

    out_dir = tmp_path / "staged"
    stats = stage(zip_path, out_dir, shard_size=1000)

    assert stats.edges_written == 6
