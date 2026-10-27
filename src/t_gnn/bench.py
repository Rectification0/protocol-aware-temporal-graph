"""NFR1/NFR2 benchmark harness (tasks.md Backlog B.7).

Measures the real code paths the two requirements are about, replacing the
proxies in tests/test_load.py (where `store.get()` stood in for inference):

- `inference` -- NFR1, "end-to-end T-GNN inference latency SHALL remain
  sub-millisecond". Since Backlog B.10 that target applies to the
  per-entity score lookup against the latest pass
  (`TGNNInferenceEngine.latest_score()`). The passes have their own budgets
  (`PASS_BUDGETS_MS`): `run_once()` (the scheduled pass, budgeted up to
  `--max-edges`) and `on_motif_completion()` (the 5.3 fast path, on a k-hop
  subgraph, budgeted at every size and also timed on a hub-heavy graph),
  timed on graphs of increasing size, with the scheduled pass split into the
  PyG `edge_index` snapshot and the forward pass itself.
- `ingest` -- NFR2, in-process: edges/second through the per-edge pipeline
  (`DecayStreamProcessor`, Active Graph Store, `MotifEngine`) with a pruning
  pass every `--prune-every` edges, extrapolated to events/day.
- `flink` -- NFR2 on the real Flink job (Backlog B.1): edges offered over
  Kafka at fixed rates to a throwaway copy of the job; "without unbounded
  queue growth" is checked directly by tracking the backlog (offered minus
  processed) over time. Needs `docker compose up -d` and the [flink] extra.

This is one machine, synthetic traffic and an untrained model, so a pass
here does not validate NFR1/NFR2 at enterprise scale (B.7 stays open for
that) -- but a miss here is a real miss: dedicated hardware won't close an
order-of-magnitude gap on its own.

    python -m t_gnn.bench all --output bench-report.json
    python -m t_gnn.bench inference --sizes 100,1000,10000
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import random
import statistics
import time
from typing import Callable, Optional

import torch

from t_gnn.cold_storage import InMemoryColdStorageWriter
from t_gnn.graph_store import ActiveGraphStore
from t_gnn.motif_engine import InMemoryMotifStateStore, MotifCompletionEvent, MotifEngine
from t_gnn.motifs import MotifRegistry
from t_gnn.pruning import EpsilonController, PruningWatcher
from t_gnn.schema import Edge
from t_gnn.streaming import DecayStreamProcessor
from t_gnn.tgnn import TGNNInferenceEngine

NFR1_LATENCY_SECONDS = 0.001  # B.10: applies to the per-entity score lookup
# B.10's pass budgets (p99), agreed with the developer 2026-10-27. The
# scheduled pass grows linearly with the graph, so its budget holds up to the
# deployment's `max_edges` (the graph's ceiling, NFR3/B.12) and isn't checked
# above it. The fast path scores one motif's neighborhood "immediately"
# (design.md 2.8), so its budget holds at every size, hub-heavy graphs included.
PASS_BUDGETS_MS = {"scheduled_pass": 50.0, "fast_path": 5.0}
DEFAULT_BUDGET_MAX_EDGES = 50_000  # matches bench_ingest's EpsilonController
# The hub-heavy case: this share of the graph's edges points into one machine
# (a domain controller, say), so a motif pivoting through it pulls a large
# incoming neighborhood into the fast path's subgraph.
HUB_EDGE_SHARE = 0.1
HUB_NODE = "Machine:dc"
NFR2_EVENTS_PER_DAY = 1_000_000_000  # "billions of events/day": the floor of that range
SECONDS_PER_DAY = 86_400

_PROTOCOL_MIX = (("Kerberos", 0.55), ("SMB", 0.25), ("DNS", 0.12), ("RDP", 0.08))
_EDGE_TYPE = {"Kerberos": "Authentication", "RDP": "Authentication", "SMB": "FileTransfer", "DNS": "Authentication"}


def synthetic_edges(n_edges: int, seed: int = 0, t0: float = 0.0, step: float = 1.0) -> list[Edge]:
    """Enterprise-shaped background traffic: ~20 edges per user and ~50 per
    machine (so node count grows with edge count), a Kerberos-heavy protocol
    mix, timestamps `step` seconds apart."""
    rng = random.Random(seed)
    users, machines = max(10, n_edges // 20), max(5, n_edges // 50)
    protocols, weights = zip(*_PROTOCOL_MIX)
    edges = []
    for i in range(n_edges):
        protocol = rng.choices(protocols, weights)[0]
        edges.append(Edge(
            src=f"User:u{rng.randrange(users)}", dst=f"Machine:m{rng.randrange(machines)}",
            edge_type=_EDGE_TYPE[protocol], protocol=protocol, t_e=t0 + i * step, w_0=rng.uniform(0.5, 1.0),
        ))
    return edges


def hub_heavy_edges(n_edges: int, seed: int = 0) -> list[Edge]:
    """`synthetic_edges()` with `HUB_EDGE_SHARE` of the edges replaced by
    user logons to one hub machine, `HUB_NODE`."""
    n_hub = int(n_edges * HUB_EDGE_SHARE)
    edges = synthetic_edges(n_edges - n_hub, seed=seed)
    rng = random.Random(seed + 1)
    users = max(10, n_edges // 20)
    edges += [
        Edge(src=f"User:u{rng.randrange(users)}", dst=HUB_NODE, edge_type="Authentication", protocol="Kerberos",
             t_e=float(n_edges + i), w_0=rng.uniform(0.5, 1.0))
        for i in range(n_hub)
    ]
    return edges


def _summary(samples: list[float]) -> dict:
    ordered = sorted(samples)
    return {
        "p50_ms": statistics.median(ordered) * 1000,
        "p99_ms": ordered[min(len(ordered) - 1, int(len(ordered) * 0.99))] * 1000,
        "max_ms": ordered[-1] * 1000,
        "samples": len(ordered),
    }


def _time(fn: Callable[[], object], repeats: int) -> list[float]:
    fn()  # warm-up: first call pays one-off allocation/JIT costs
    out = []
    for _ in range(repeats):
        start = time.perf_counter()
        fn()
        out.append(time.perf_counter() - start)
    return out


def _hub_fast_path(n_edges: int, n_repeats: int, seed: int) -> tuple[dict, dict]:
    """The fast path for a motif pivoting on a user who logs on to the hub."""
    store = ActiveGraphStore()
    edges = hub_heavy_edges(n_edges, seed=seed)
    for edge in edges:
        store.upsert(edge)
    engine = TGNNInferenceEngine(store=store)
    chain_key = next(e.src for e in edges if e.dst == HUB_NODE)
    event = MotifCompletionEvent(motif_name="bench", chain_key=chain_key, matched_edges=[], completed_at=0.0)
    _, sub_edge_ids, sub_nodes = store.in_subgraph(engine._neighborhood_for(event), engine.model.num_layers)
    timing = _summary(_time(lambda: engine.on_motif_completion(event), n_repeats))
    return timing, {"edges": len(sub_edge_ids), "nodes": len(sub_nodes)}


def bench_inference(sizes: list[int], repeats: int = 20, seed: int = 0, max_edges: int = DEFAULT_BUDGET_MAX_EDGES,
                    log=print) -> dict:
    results = []
    for n_edges in sizes:
        store = ActiveGraphStore()
        for edge in synthetic_edges(n_edges, seed=seed):
            store.upsert(edge)
        engine = TGNNInferenceEngine(store=store)
        n_repeats = max(3, repeats if n_edges < 100_000 else repeats // 4)

        edge_index, _, node_index = store.to_pyg_edge_index()
        ordered = list(node_index)
        x = torch.cat([engine.model.entity_features.rows_for(ordered), torch.zeros(len(ordered), 1)], dim=1)
        chain_key = next(n for n in ordered if n.startswith("User:"))
        event = MotifCompletionEvent(motif_name="bench", chain_key=chain_key, matched_edges=[], completed_at=0.0)
        _, sub_edge_ids, sub_nodes = store.in_subgraph(engine._neighborhood_for(event), engine.model.num_layers)

        rng = random.Random(seed)
        lookups = [rng.choice(ordered) for _ in range(1000)]
        lookup_iter = iter(lookups * (n_repeats * 50 + 2))

        row = {
            "edges": n_edges,
            "nodes": len(node_index),
            "scheduled_pass": _summary(_time(lambda: engine.run_once(t=0.0), n_repeats)),
            "fast_path": _summary(_time(lambda: engine.on_motif_completion(event), n_repeats)),
            "fast_path_subgraph": {"edges": len(sub_edge_ids), "nodes": len(sub_nodes)},
            "score_lookup": _summary(_time(lambda: engine.latest_score(next(lookup_iter)), n_repeats * 50)),
            "materialize_edge_index": _summary(_time(store.to_pyg_edge_index, n_repeats)),
            "forward_only": _summary(_time(lambda: engine.model.forward(edge_index, x), n_repeats)),
        }
        row["hub_fast_path"], row["hub_fast_path_subgraph"] = _hub_fast_path(n_edges, n_repeats, seed)
        fast_budget, scheduled_budget = PASS_BUDGETS_MS["fast_path"], PASS_BUDGETS_MS["scheduled_pass"]
        row["meets_nfr1"] = row["score_lookup"]["p99_ms"] < NFR1_LATENCY_SECONDS * 1000
        row["within_budget"] = {
            # None: above max_edges, where the scheduled-pass budget doesn't apply
            "scheduled_pass": row["scheduled_pass"]["p99_ms"] < scheduled_budget if n_edges <= max_edges else None,
            "fast_path": row["fast_path"]["p99_ms"] < fast_budget,
            "hub_fast_path": row["hub_fast_path"]["p99_ms"] < fast_budget,
        }
        results.append(row)
        log(f"inference {n_edges:>8} edges {row['nodes']:>7} nodes | lookup p99 {row['score_lookup']['p99_ms'] * 1000:6.1f}us | "
            f"scheduled p50 {row['scheduled_pass']['p50_ms']:8.2f}ms p99 {row['scheduled_pass']['p99_ms']:8.2f}ms | "
            f"fast path p99 {row['fast_path']['p99_ms']:6.2f}ms ({len(sub_edge_ids)} edges) | "
            f"hub fast path p99 {row['hub_fast_path']['p99_ms']:6.2f}ms ({row['hub_fast_path_subgraph']['edges']} edges) | "
            f"snapshot p50 {row['materialize_edge_index']['p50_ms']:7.2f}ms forward p50 {row['forward_only']['p50_ms']:7.2f}ms")
    return {"nfr1_target_ms": NFR1_LATENCY_SECONDS * 1000, "nfr1_measures": "score_lookup",
            "pass_budgets_ms": PASS_BUDGETS_MS, "budget_max_edges": max_edges, "sizes": results}


def bench_ingest(n_edges: int = 100_000, prune_every: int = 1000, seed: int = 0, log=print) -> dict:
    edges = synthetic_edges(n_edges, seed=seed)
    processor = DecayStreamProcessor()
    store = ActiveGraphStore()
    motif_engine = MotifEngine(definitions=MotifRegistry().all(), state_store=InMemoryMotifStateStore())
    inference = TGNNInferenceEngine(store=store)
    watcher = PruningWatcher(
        store=store, decay_engine=processor.decay_engine,
        epsilon_controller=EpsilonController(epsilon_min=0.05, epsilon_max=0.4, max_edges=50_000),
        cold_storage=InMemoryColdStorageWriter(), memory_probe=lambda: None,
    )

    per_edge = []
    start = time.perf_counter()
    for i, edge in enumerate(edges, 1):
        t = time.perf_counter()
        processed = processor.process(edge, t=edge.t_e)
        store.upsert(processed.edge)
        inference.observe_deviation(processed.deviation)
        motif_engine.on_edge(edge)
        per_edge.append(time.perf_counter() - t)
        if i % prune_every == 0:
            watcher.run_once(t=edge.t_e)
    elapsed = time.perf_counter() - start

    rate = n_edges / elapsed
    result = {
        "edges": n_edges,
        "elapsed_s": elapsed,
        "edges_per_second": rate,
        "events_per_day": rate * SECONDS_PER_DAY,
        "per_edge": _summary(per_edge),
        "final_graph_size": len(store),
        "target_events_per_day": NFR2_EVENTS_PER_DAY,
        "meets_nfr2_single_process": rate * SECONDS_PER_DAY >= NFR2_EVENTS_PER_DAY,
        "processes_needed_for_nfr2": NFR2_EVENTS_PER_DAY / (rate * SECONDS_PER_DAY),
        "note": "excludes the scheduled inference pass and cold-storage I/O (in-memory writer)",
    }
    log(f"ingest {n_edges} edges in {elapsed:.1f}s = {rate:,.0f} edges/s = {result['events_per_day'] / 1e6:,.0f}M/day "
        f"= {1 / result['processes_needed_for_nfr2']:.2f}x the NFR2 floor of 1,000M/day")
    return result


def bench_flink(rates: list[int], duration: float = 30.0, drain_timeout: float = 120.0, job_args: Optional[list[str]] = None,
                edge_partitions: int = 1, log=print) -> dict:
    from t_gnn.flink.harness import IsolatedJob
    from t_gnn.flink.kafka_io import drain, make_producer, produce_edge, publish_lambdas, tail_consumer
    from t_gnn.protocol_registry import ProtocolDecayRegistry

    runs = []
    with IsolatedJob("t-gnn-bench", job_args, edge_partitions=edge_partitions) as job:
        consumer = tail_consumer([job.topics["decayed"]])
        producer = make_producer()
        publish_lambdas(producer, ProtocolDecayRegistry(), topic=job.topics["lambdas"])
        t0 = 2_000_000.0
        try:
            for rate in rates:
                edges = synthetic_edges(int(rate * duration), seed=rate, t0=t0, step=1.0 / rate)
                run_ids = {e.edge_id for e in edges}
                t0 = edges[-1].t_e + 1.0
                seen: set[str] = set()
                duplicates = 0

                def count_new(timeout: float) -> int:
                    """This run's records only (a previous run's tail can still
                    be arriving), each edge once (the sink is at-least-once)."""
                    nonlocal duplicates
                    new = 0
                    for _, value in drain(consumer, timeout=timeout):
                        edge_id = json.loads(value)["edge"]["edge_id"]
                        if edge_id not in run_ids:
                            continue
                        if edge_id in seen:
                            duplicates += 1
                        else:
                            seen.add(edge_id)
                            new += 1
                    return new

                produced = consumed = 0
                timeline = []
                start = time.monotonic()
                next_sample = start + 1.0
                while produced < len(edges) or time.monotonic() - start < duration:
                    due = min(len(edges), int((time.monotonic() - start) * rate))
                    while produced < due:
                        produce_edge(producer, edges[produced], topic=job.topics["edges"])
                        produced += 1
                    consumed += count_new(0.005)
                    if time.monotonic() >= next_sample:
                        timeline.append({"t": round(time.monotonic() - start, 1), "produced": produced,
                                         "processed": consumed, "backlog": produced - consumed})
                        next_sample += 1.0
                producer.flush(30)
                offer_window = time.monotonic() - start
                processed_in_window = consumed
                drain_start = time.monotonic()
                while consumed < produced and time.monotonic() - drain_start < drain_timeout:
                    consumed += count_new(0.5)
                drain_seconds = time.monotonic() - drain_start

                # Bounded queue = the backlog stops growing: compare its average
                # over the last third of the window with the middle third.
                third = max(1, len(timeline) // 3)
                mid = statistics.mean(s["backlog"] for s in timeline[third:2 * third]) if len(timeline) >= 3 else 0
                late = statistics.mean(s["backlog"] for s in timeline[-third:]) if timeline else 0
                growth_per_s = (late - mid) / max(1.0, third)
                run = {
                    "offered_rate": rate,
                    "offered_edges": produced,
                    "processed_rate_during_offer": processed_in_window / offer_window,
                    "max_backlog": max((s["backlog"] for s in timeline), default=0),
                    "backlog_growth_per_s": growth_per_s,
                    # Both: the backlog stops growing, and nearly all of the offered
                    # rate gets processed (a slow creep can hide inside the first test).
                    "bounded": growth_per_s <= 0.05 * rate and processed_in_window / offer_window >= 0.95 * rate,
                    "drained": consumed >= produced,
                    "drain_seconds": drain_seconds,
                    "duplicates": duplicates,
                    "timeline": timeline,
                }
                runs.append(run)
                log(f"flink offered {rate:>6,}/s for {duration:.0f}s: processed {run['processed_rate_during_offer']:8,.0f}/s, "
                    f"max backlog {run['max_backlog']:>8,}, backlog growth {growth_per_s:8,.0f}/s -> "
                    f"{'bounded' if run['bounded'] else 'UNBOUNDED'}"
                    f"{'' if run['drained'] else f' (still {produced - consumed:,} behind after {drain_timeout:.0f}s)'}"
                    f"{f', {duplicates:,} duplicate(s)' if duplicates else ''}")
        finally:
            consumer.close()

    sustained = [r["offered_rate"] for r in runs if r["bounded"] and r["drained"]]
    best = max(sustained, default=0)
    return {
        "runs": runs,
        "max_sustained_rate": best,
        "max_sustained_events_per_day": best * SECONDS_PER_DAY,
        "target_events_per_day": NFR2_EVENTS_PER_DAY,
        "job_args": job_args or [],
        "edge_partitions": edge_partitions,
        "note": "job parallelism as given in job_args (default 1); taskmanagers as the compose cluster has them",
    }


def machine_info() -> dict:
    return {
        "platform": platform.platform(),
        "processor": platform.processor(),
        "logical_cpus": os.cpu_count(),
        "python": platform.python_version(),
        "torch": torch.__version__,
        "torch_threads": torch.get_num_threads(),
        "measured_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("inference", "ingest", "flink", "all"))
    parser.add_argument("--sizes", default="100,1000,10000,50000,100000", help="inference: graph sizes in edges")
    parser.add_argument("--max-edges", type=int, default=DEFAULT_BUDGET_MAX_EDGES,
                        help="inference: the deployment's max_edges; the scheduled-pass budget is checked up to it")
    parser.add_argument("--repeats", type=int, default=20, help="inference: timed runs per size")
    parser.add_argument("--edges", type=int, default=100_000, help="ingest: edges to push through")
    parser.add_argument("--prune-every", type=int, default=1000, help="ingest: edges between pruning passes")
    parser.add_argument("--rates", default="1000,2000,5000,10000", help="flink: offered edges/second, one run each")
    parser.add_argument("--duration", type=float, default=30.0, help="flink: seconds to offer each rate")
    parser.add_argument("--parallelism", type=int, default=1, help="flink: the job's operator parallelism")
    parser.add_argument("--edge-partitions", type=int, default=None,
                        help="flink: partitions for the throwaway edges topic (default: --parallelism, Backlog B.11)")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--output", default=None, help="write the full JSON report here")
    args = parser.parse_args(argv)

    report = {"machine": machine_info()}
    if args.command in ("inference", "all"):
        report["nfr1_inference"] = bench_inference([int(s) for s in args.sizes.split(",")], args.repeats, args.seed,
                                                   max_edges=args.max_edges)
    if args.command in ("ingest", "all"):
        report["nfr2_ingest_in_process"] = bench_ingest(args.edges, args.prune_every, args.seed)
    if args.command in ("flink", "all"):
        report["nfr2_flink"] = bench_flink([int(r) for r in args.rates.split(",")], args.duration,
                                           job_args=["--parallelism", str(args.parallelism)],
                                           edge_partitions=args.edge_partitions or args.parallelism)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        print(f"report written to {args.output}")


if __name__ == "__main__":
    main()
