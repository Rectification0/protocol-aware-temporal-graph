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


def test_inference_report_times_lookup_against_nfr1_and_passes_against_their_budgets():
    report = bench.bench_inference([60, 300], repeats=3, max_edges=100, log=lambda *_: None)
    assert report["nfr1_target_ms"] == 1.0
    assert report["nfr1_measures"] == "score_lookup"
    assert report["pass_budgets_ms"] == {"scheduled_pass": 50.0, "fast_path": 5.0}
    assert report["budget_max_edges"] == 100
    assert [row["edges"] for row in report["sizes"]] == [60, 300]
    for row in report["sizes"]:
        assert row["nodes"] > 0
        for path in ("scheduled_pass", "fast_path", "materialize_edge_index", "forward_only"):
            assert row[path]["samples"] == 3
            assert 0 < row[path]["p50_ms"] <= row[path]["p99_ms"] <= row[path]["max_ms"]
        # a lookup can be below the timer's resolution, so it may read as 0
        assert row["score_lookup"]["samples"] == 150
        assert 0 <= row["score_lookup"]["p50_ms"] <= row["score_lookup"]["p99_ms"]
        assert row["meets_nfr1"] == (row["score_lookup"]["p99_ms"] < 1.0)
        for path in ("fast_path", "hub_fast_path"):
            assert row[path]["samples"] == 3
            assert row["within_budget"][path] == (row[path]["p99_ms"] < 5.0)
        assert 0 < row["fast_path_subgraph"]["nodes"] <= row["nodes"]
        assert row["fast_path_subgraph"]["edges"] <= row["edges"]
        # the hub's whole incoming neighborhood is in the subgraph
        assert row["hub_fast_path_subgraph"]["edges"] >= int(row["edges"] * bench.HUB_EDGE_SHARE)
    small, large = report["sizes"]
    assert small["within_budget"]["scheduled_pass"] == (small["scheduled_pass"]["p99_ms"] < 50.0)
    assert large["within_budget"]["scheduled_pass"] is None  # 300 edges > max_edges=100: not checked


def test_hub_heavy_edges_point_the_configured_share_at_the_hub():
    edges = bench.hub_heavy_edges(1000, seed=2)
    assert len(edges) == 1000
    assert sum(e.dst == bench.HUB_NODE for e in edges) == 100
    for edge in edges:
        edge.validate()


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
