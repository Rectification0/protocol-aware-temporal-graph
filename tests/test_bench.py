"""Backlog B.7: the NFR1/NFR2 benchmark harness (`t_gnn.bench`), at toy sizes.

Checks the harness runs and reports what it claims; the real measurements
come from `python -m t_gnn.bench all` (docs/benchmarks.md). The Flink part
needs the compose stack and is exercised by running the benchmark itself.
"""

import json

from t_gnn import bench


def test_synthetic_edges_are_deterministic_and_time_ordered():
    a, b = bench.synthetic_edges(200, seed=3), bench.synthetic_edges(200, seed=3)
    assert [e.edge_id for e in a] == [e.edge_id for e in b]
    assert [e.t_e for e in a] == sorted(e.t_e for e in a)
    assert {e.protocol for e in a} <= {"Kerberos", "SMB", "DNS", "RDP"}
    for edge in a:
        edge.validate()


def test_inference_report_times_both_paths_against_the_nfr1_target():
    report = bench.bench_inference([60, 300], repeats=3, log=lambda *_: None)
    assert report["target_ms"] == 1.0
    assert [row["edges"] for row in report["sizes"]] == [60, 300]
    for row in report["sizes"]:
        assert row["nodes"] > 0
        for path in ("scheduled_pass", "fast_path", "materialize_edge_index", "forward_only"):
            assert row[path]["samples"] == 3
            assert 0 < row[path]["p50_ms"] <= row[path]["p99_ms"] <= row[path]["max_ms"]
        assert row["meets_nfr1"]["scheduled_pass"] == (row["scheduled_pass"]["p99_ms"] < 1.0)


def test_ingest_report_extrapolates_throughput_to_events_per_day():
    report = bench.bench_ingest(n_edges=2000, prune_every=500, log=lambda *_: None)
    assert report["edges"] == 2000
    assert report["events_per_day"] == report["edges_per_second"] * 86_400
    assert report["meets_nfr2_single_process"] == (report["events_per_day"] >= 1e9)
    assert 0 < report["final_graph_size"] <= 2000


def test_cli_writes_a_json_report(tmp_path):
    out = tmp_path / "report.json"
    bench.main(["inference", "--sizes", "60", "--repeats", "3", "--output", str(out)])
    report = json.loads(out.read_text())
    assert report["machine"]["logical_cpus"] > 0
    assert report["nfr1_inference"]["sizes"][0]["edges"] == 60
