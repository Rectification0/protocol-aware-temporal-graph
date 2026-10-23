# NFR1/NFR2 benchmarks (Backlog B.7)

Measured with `python -m t_gnn.bench` on 2026-10-23. These are real
measurements of the real code paths, which the earlier proxy tests in
`tests/test_load.py` were not: those timed `store.get()` as a stand-in for
inference. They come from one developer machine, synthetic traffic and an
untrained model, so they **do not validate the requirements at enterprise
scale**, and B.7 stays open for that. They are still conclusive in one
direction: a miss of one to two orders of magnitude here will not be closed
by better hardware alone.

**Machine.** Windows 11, Intel 14 logical CPUs, Python 3.12.9, torch
2.10.0+cpu (12 threads). Docker Desktop VM: 14 CPUs, 8 GB. Flink 1.18.1, one
taskmanager, job parallelism 1.

```bash
python -m t_gnn.bench inference --output inference.json        # NFR1
python -m t_gnn.bench ingest --output ingest.json              # NFR2, in-process
python -m t_gnn.bench flink --rates 200,300,400,500,600,700,800 # NFR2, real Flink job (needs the compose stack)
python -m t_gnn.bench all --output bench-report.json           # everything
```

Each run writes the machine details and every sample summary to JSON.
Traffic is `bench.synthetic_edges()`: about 20 edges per user and 50 per
machine, so node count grows with edge count, and a Kerberos-heavy protocol
mix.

## Summary

| Requirement | Target | Measured | Verdict |
|---|---|---|---|
| NFR1, scheduled inference pass | < 1 ms | p99 2.5 ms at 100 edges, 28 ms at 10k, 277 ms at 100k | **Not met** at any size |
| NFR1, motif fast path (5.3) | < 1 ms | p99 2.4 ms at 100 edges, 292 ms at 100k | **Not met**: it costs as much as a full pass |
| NFR2, in-process pipeline | ≥ 1 B events/day | 11,600 edges/s ≈ 1.0 B/day | **Borderline**, and only with no Redis, Neo4j or inference in the loop |
| NFR2, Flink job | ≥ 1 B events/day, bounded queue | Bounded up to ~600 edges/s (~52 M/day); saturates ~660/s | **Not met**: about 5% of the floor at parallelism 1 |

## NFR1: inference latency

`TGNNInferenceEngine.run_once()` is the scheduled pass and
`on_motif_completion()` is the fast path. The two right-hand columns split
the pass into its parts.

| Edges | Nodes | Scheduled p50 / p99 | Fast path p50 / p99 | Materialize `edge_index` p50 | Forward pass p50 |
|---:|---:|---:|---:|---:|---:|
| 100 | 15 | 1.3 / 2.5 ms | 1.2 / 2.4 ms | 0.08 ms | 0.9 ms |
| 1,000 | 70 | 2.8 / 5.0 ms | 3.4 / 5.8 ms | 1.1 ms | 1.3 ms |
| 10,000 | 700 | 18 / 28 ms | 21 / 35 ms | 11 ms | 2.6 ms |
| 100,000 | 7,000 | 250 / 277 ms | 211 / 292 ms | 134 ms | 15 ms |

What the numbers say:
- **Even the forward pass alone misses at the smallest size**: 0.9 ms
  median for 15 nodes, with nothing else counted. A two-layer `SAGEConv` on
  CPU through PyTorch's eager dispatch has a fixed per-call overhead near
  the budget.
- **Above ~1k edges, materializing `edge_index` dominates.**
  `ActiveGraphStore.to_pyg_edge_index()` rebuilds the whole tensor graph
  from the hash map on every pass, by design (Phase 5: "a pruned edge is
  simply absent next pass"). It's O(edges) in Python, about 1.3 µs per edge.
- **The fast path isn't targeted.** It scores the motif's neighborhood
  but runs the forward pass over the whole graph to get there, so it costs
  the same as a scheduled pass.
- What remains (the gap between the scheduled pass and the two parts) is
  per-node Python: feature-row assembly, building one `InferenceResult` per
  node, and publishing each one on the bus.

Possible directions (not attempted, since they're design decisions):
maintain `edge_index` incrementally instead of rebuilding it; have the fast
path run on a k-hop subgraph (`torch_geometric.utils.k_hop_subgraph`);
batch result publishing; and decide what NFR1 actually times. A per-entity
score lookup against the latest scheduled pass would be sub-millisecond
already, but a full pass over an enterprise graph cannot be.

## NFR2: throughput

### In-process (`--decay-backend local`)

100,000 edges through `DecayStreamProcessor`, `ActiveGraphStore.upsert`,
`TGNNInferenceEngine.observe_deviation` and `MotifEngine.on_edge` (in-memory
state store), with a pruning pass every 1,000 edges: **11,596 edges/s ≈
1.00 B/day**, per-edge p50 0.03 ms, p99 0.17 ms.

That is the NFR2 floor with nothing to spare, and it leaves out three
things a real deployment pays for: Redis round-trips for motif state (the
benchmark uses the in-memory store), Neo4j writes for pruned edges (the
in-memory writer), and the scheduled inference pass competing for the same
process.

**NFR3 observation.** The run ended with 53,702 live edges against
`max_edges=50,000`. `EpsilonController` treats `max_edges` as a pressure
input, not a hard cap. At full pressure ε rises only to `epsilon_max` (0.4
here), and freshly ingested edges weighted above it survive. NFR3 asks for
a ceiling "enforced via FR2", so this is a gap worth its own follow-up.

### Real Flink job (`--decay-backend flink`)

A throwaway copy of the job (`t_gnn.flink.harness.IsolatedJob`) is offered
edges over Kafka at a fixed rate for 30 s per rate. The backlog (offered
minus processed, counting each run's own edges once) is sampled every
second. "Bounded" means the backlog stopped growing *and* at least 95% of
the offered rate was processed.

| Offered | Processed | Max backlog | Verdict |
|---:|---:|---:|---|
| 200/s | 199/s | 432 | bounded |
| 300/s | 299/s | 46 | bounded |
| 400/s | 399/s | 74 | bounded |
| 500/s | 497/s | 88 | bounded |
| 600/s | 597/s | 613 | bounded |
| 700/s | 652/s | 1,411 | unbounded (93% processed, backlog creeping) |
| 800/s | 664/s | 4,062 | unbounded |
| 1,000/s | 670/s | 9,868 | unbounded |

The job sustains **~600 edges/s ≈ 52 M events/day**, about 5% of the NFR2
floor, and saturates around 660/s. Flink reports the `decay` operator 100%
busy. The cost is Python per record, chiefly keyed-state access: the
operator is keyed by edge id (design.md 2.1), so every edge is a new key.

## Bugs the benchmark found (all fixed)

1. **Checkpoints overflowed and the job crash-looped.** Flink's default
   checkpoint storage keeps checkpoints in jobmanager memory, capped at
   5 MB. The decay operator holds every edge it is still re-evaluating, so
   past ~25k live edges every checkpoint failed. The job then hit its
   failure threshold, restarted, and replayed from the last committed
   offsets, which produced duplicates and then no progress at all. The
   long-running job would have hit this too. Fix: filesystem checkpoint
   storage on a `flink-checkpoints` volume shared by both containers
   (`docker-compose.yml`).
2. **Python execution mode.** In PyFlink's default "process" mode every
   keyed-state access crosses a gRPC boundary to a separate Python worker.
   Isolating the cost with stripped-down variants showed one state write
   per new key took throughput from ~820/s to ~206/s. "Thread" mode (Python
   inside the JVM, through pemja) is about 3–4× faster, so it is now the
   job's default (`--execution-mode`). The operator was also cut to one
   state write per edge.
3. **A side output emitted from a timer crashes in thread mode.** PyFlink
   1.18's embedded keyed co-process operator pushes the raw `(tag, value)`
   pair onto the main output, and the String serializer throws
   `ClassCastException`. The job now emits one tagged stream that two
   chained filters split.

Before these fixes the job managed ~106 edges/s and fell over under
sustained load. After them it sustains ~600/s, with no restarts or
duplicates across the sweep.

## What would move the numbers

- **Flink**: raise `--parallelism`, and the taskmanager's slots and CPUs to
  match. Python operators scale out per subtask. The bigger lever is
  re-keying the decay operator by `(entity, protocol)` so keys repeat and
  state stays hot, folding it into the baseline operator; that changes
  design.md 2.1's keyed-by-edge-id layout. Moving the hot path to a Java
  operator would likely gain the most, at the cost of a second
  implementation of the decay logic.
- **Inference**: see the NFR1 directions above.
- **Real validation** (what B.7 actually asks for): enterprise-scale
  traffic on production-class infrastructure. That is the same acquisition
  gap tasks 0.4 and 7.3 document, and nothing in this repo can close it.
