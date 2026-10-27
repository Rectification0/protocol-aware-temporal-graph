# NFR1/NFR2 benchmarks (Backlog B.7, B.10)

Measured with `python -m t_gnn.bench` on 2026-10-23 (B.7) and again on
2026-10-27 after Backlog B.10's inference rework. These are real
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

Since Backlog B.10 (2026-10-27), NFR1's sub-millisecond target applies to
the per-entity score lookup against the latest pass. The two passes have
their own budgets instead. See [B.10](#b10-nfr1-rework-2026-10-27) for the
numbers before and after.

| Requirement | Target | Measured | Verdict |
|---|---|---|---|
| NFR1, per-entity score lookup | < 1 ms | p99 ≤ 1.4 µs at every size | **Met** |
| Scheduled inference pass | ≤ 50 ms p99 up to `max_edges` (B.10 budget; 50k in the benchmark) | p99 17 ms at 50k edges (19 ms at 100k, above the cap) | **Within budget** |
| Motif fast path (5.3), ordinary traffic | ≤ 5 ms p99 at any size (B.10 budget) | p99 1.1–2.7 ms, flat from 1k to 100k edges | **Within budget** |
| Motif fast path (5.3), through a hub | ≤ 5 ms p99 at any size (B.10 budget) | p99 2.1 ms at 10k edges, 8.4 ms at 50k, 18.7 ms at 100k | **Missed** at 50k and above. Needs a subgraph cap (Backlog B.13) |
| NFR2, in-process pipeline | ≥ 1 B events/day | 11,600 edges/s ≈ 1.0 B/day on 2026-10-23; ~24,000 edges/s ≈ 2.1 B/day on 2026-10-27 (same machine, less loaded, B.10 code) | **Borderline to met**, and only with no Redis, Neo4j or inference in the loop |
| NFR2, Flink job | ≥ 1 B events/day, bounded queue | Bounded up to ~600 edges/s (~52 M/day); saturates ~660/s | **Not met**: about 5% of the floor at parallelism 1 |

## B.10: NFR1 rework (2026-10-27)

Decided with the developer after the B.7 numbers below. A full pass over an
enterprise graph cannot fit in a millisecond, so NFR1 now times what an
analyst or downstream consumer actually waits on: reading one entity's
latest score (`TGNNInferenceEngine.latest_score()`). The passes were then
made cheaper, and each got its own budget (`bench.PASS_BUDGETS_MS`, agreed
with the developer on 2026-10-27):

- **Scheduled pass: ≤ 50 ms p99 at `max_edges`.** The pass grows linearly
  with the graph (about 0.15–0.2 µs per edge), so a fixed number with no
  size attached would promise nothing. It's tied to `max_edges`, the
  graph's ceiling (NFR3; B.12 makes it a hard cap), and the benchmark checks
  it at every size up to `--max-edges` (default 50,000, matching the ingest
  run). Above that it reports `null`, not a pass or fail.
- **Fast path: ≤ 5 ms p99 at any graph size.** design.md 2.8 asks for
  "immediate" scoring of one motif's neighborhood. The practical floor is
  ~1.5–2 ms (the forward pass alone is ~0.4 ms), so 1 ms isn't reachable
  without changing the model or its runtime.

**The hub-heavy case.** The fast path's cost follows the number of incoming
edges around the motif's entities, not the graph size. A motif that pivots
through a hub (a domain controller everyone logs on to) pulls the hub's
whole incoming neighborhood into the subgraph. The plain synthetic traffic
has no such hubs, so the benchmark also builds a graph with 10% of its edges
pointing into one machine (`bench.hub_heavy_edges()`) and times a motif on a
user who logs on to it.

Two changes:

1. **Incremental `edge_index`.** `ActiveGraphStore` keeps its PyG columns
   in step with every `upsert`/`remove` (swap-with-last on removal), so a
   pass copies two arrays instead of rebuilding the tensor from every
   `Edge` in Python.
2. **The fast path runs on a k-hop subgraph.** `ActiveGraphStore.in_subgraph()`
   collects the 2-hop *incoming* neighborhood of the motif's entities
   straight from the adjacency sets. `SAGEConv` aggregates over incoming
   edges, so a 2-layer pass over that subgraph gives those entities exactly
   the full-graph scores (`tests/test_tgnn.py` checks this, with real
   second-hop edges).

Before and after on the same machine, back to back (p50 / p99), on the
plain synthetic traffic.
The machine was less loaded than on 2026-10-23: the untouched forward pass
alone ran about 2× faster. So compare these two columns with each other,
not with the B.7 table below.

| Edges | Scheduled pass, before → after | Fast path, before → after (subgraph size) | `edge_index` snapshot p50 | Score lookup p50 / p99 |
|---:|---:|---:|---:|---:|
| 100 | 0.51 / 0.70 → 0.42 / 0.59 ms | 0.50 / 0.55 → 0.48 / 0.73 ms (100 edges) | 0.04 → 0.01 ms | 0.4 / 0.5 µs |
| 1,000 | 1.0 / 2.3 → 0.53 / 0.77 ms | 1.2 / 2.7 → 0.83 / 1.8 ms (641) | 0.38 → 0.04 ms | 1.0 / 1.4 µs |
| 10,000 | 10.5 / 13.3 → 2.1 / 8.0 ms | 6.4 / 11.5 → 1.7 / 2.6 ms (1,149) | 3.3 → 0.06 ms | 0.3 / 0.6 µs |
| 100,000 | 104 / 117 → 14 / 19 ms | 99 / 106 → 1.7 / 2.3 ms (908) | 39 → 1.3 ms | 0.7 / 1.2 µs |

- **The fast path is now flat on ordinary traffic:** about 1,000 edges of
  subgraph whatever the graph size, so 46× cheaper at 100k edges. On a
  100-edge graph the subgraph *is* the graph, and building it costs a
  little more than slicing the full snapshot.
- **What's left of the scheduled pass at 100k** is mostly the forward pass
  (5 ms) and per-node Python: building and publishing 7,000
  `InferenceResult`s, plus feature-row assembly.
Against the agreed budgets (B.10 code only, a separate run on the same day;
p50 / p99, with the fast path's subgraph size):

| Edges | Scheduled pass (≤ 50 ms up to 50k) | Fast path (≤ 5 ms) | Hub fast path (≤ 5 ms) | Score lookup p99 |
|---:|---:|---:|---:|---:|
| 100 | 0.43 / 0.70 ms | 0.47 / 1.09 ms (100 edges) | 0.46 / 0.59 ms (100) | 0.5 µs |
| 1,000 | 0.58 / 1.51 ms | 0.77 / 1.59 ms (641) | 0.83 / 0.98 ms (767) | 0.7 µs |
| 10,000 | 2.2 / 2.6 ms | 1.7 / 2.0 ms (1,149) | 1.6 / 2.1 ms (2,047) | 0.9 µs |
| 50,000 | 7.8 / 17 ms | 1.3 / 1.9 ms (727) | 6.7 / **8.4 ms** (6,058) | 1.0 µs |
| 100,000 | 14 / 19 ms (above the cap, not checked) | 2.1 / 2.7 ms (908) | 15 / **18.7 ms** (10,935) | 1.3 µs |

- **The hub case misses the fast-path budget from 50k edges up.** The
  subgraph is the hub's whole incoming neighborhood (5k and 10k logons),
  and at 100k edges the fast path costs as much as a full scheduled pass.
  Meeting the budget there needs a cap on subgraph size, for example
  sampling a hub's incoming edges, or falling back to the latest scheduled
  score when the subgraph is too big. Either one changes scores slightly
  for hub-adjacent entities, so it's tracked as its own decision
  (Backlog B.13), not folded into B.10.
- **Cost on ingest:** the incremental bookkeeping makes `upsert` slower.
  Three back-to-back runs of `bench ingest` averaged ~24,100 edges/s with
  B.10 against ~26,300 without, a 5–10% drop (the runs vary by ±1,500/s).
  That is still about 2 B events/day in-process.

The score lookup is in-process. The dashboard's own lookup
(`GET /api/scores/entities/{id}`) goes through Postgres in the separate API
process, so this number doesn't cover it.

## NFR1: inference latency (B.7, 2026-10-23, before B.10)

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

Possible directions, as written on 2026-10-23: maintain `edge_index`
incrementally instead of rebuilding it; have the fast path run on a k-hop
subgraph; batch result publishing; and decide what NFR1 actually times. A
per-entity score lookup against the latest scheduled pass would be
sub-millisecond already, but a full pass over an enterprise graph cannot
be. B.10 did all of these except batching result publishing (see above).

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
- **Inference**: after B.10, the scheduled pass's remaining cost is the
  forward pass and per-node result handling. Batching `InferenceResult`
  publishing would cut the second. The fast path needs a subgraph-size cap
  to hold its budget around hubs (B.13).
- **Real validation** (what B.7 actually asks for): enterprise-scale
  traffic on production-class infrastructure. That is the same acquisition
  gap tasks 0.4 and 7.3 document, and nothing in this repo can close it.
