"""Continuously-running driver: wires every real component in this repo
together into one live process, the piece nothing else in the codebase
provides (each phase is otherwise exercised individually by tests/CLIs).

Since Phase 1's "Flink job" was deliberately never deployed (tasks.md
Backlog B.1), there is no live production event source to read from. This
script's default `--source synthetic` substitutes a continuously-generated
synthetic traffic stream (background authentication noise, reusing
`simulate_traffic.py`'s generators, plus periodically injected attack
scenarios). `--source replay --staged-dir <dir>` instead replays a real
staged directory (`stage_lanl.py`/`simulate_traffic.py` output, or any
other producer of the shared shard-*.jsonl format -- e.g. Backlog B.8's
`stage_mordor.py` on the separate `feature/mordor-ingestion` branch) in
timestamp order, finite -- it stops once the staged edges are exhausted,
rather than running until Ctrl+C. Either way, everything the traffic
flows through is real, not staged:

  - `DecayStreamProcessor` (1.3-1.5) -- real decay + EWMA baseline deviation.
  - `ActiveGraphStore`/`ShardedActiveGraphStore` (2.1) -- real in-memory graph.
  - `PruningWatcher` + `EpsilonController` (2.2/2.3) writing to a real
    Neo4j instance via `BufferedColdStorageWriter`/`Neo4jColdStorageWriter`
    (2.4/6.4) -- requires `docker compose up -d`.
  - `MotifEngine` (3.2-3.5) backed by a real Redis instance via
    `RedisMotifStateStore`/`ShardedMotifStateStore` (3.3) -- also requires
    `docker compose up -d`; degrades gracefully (6.3) if Redis is down.
  - `TGNNInferenceEngine`/`DynamicTGNN` (5.1-5.3) -- real PyTorch Geometric
    forward pass, fed the live deviation signal and fast-pathed on motif
    completion.
  - `MetricsCollector`/`AuditLogger` (6.1/6.2) -- real in-process
    aggregation/logging of every event the above already emits.
  - `AdaptiveDecayCalibrator` (Backlog B.3), optional -- observes the same
    live edges and pushes recalibrated lambda_p values into the registry.
  - `ApiStateWriter` (`api_state.py`, tasks.md F0), on by default (disable
    with `--no-api-persist`) -- persists metrics snapshots, motif
    completions/resets, and entity scores to Postgres, the bridge that lets
    the separate, decoupled frontend API service (`t_gnn.api`) see this
    process's live state without sharing memory with it. Degrades
    gracefully (a warning, not a crash) if Postgres is unreachable.

Not wired in here: `MotifPriorityTracker`/`MotifFeedbackBus` (Backlog B.6)
-- that loop is inherently human-driven (an analyst's true/false-positive
disposition of a past alert), so there's nothing for an unattended
continuous demo to feed it automatically. The frontend API service
(`t_gnn.api`) exposes a feedback-submission endpoint (F9.5) for that
human-driven path instead.

Usage:
    docker compose up -d
    python scripts/run_pipeline.py
    python scripts/run_pipeline.py --shards 3 --fuzzy --attack-every 20
    python scripts/run_pipeline.py --max-ticks 200   # finite synthetic run instead of Ctrl+C
    python scripts/run_pipeline.py --source replay --staged-dir data/lanl/simulated/staged
"""

from __future__ import annotations

import argparse
import dataclasses
import itertools
import os
import random
import sys
import time
from pathlib import Path
from typing import Iterator, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import redis  # noqa: E402

import t_gnn.db  # noqa: E402,F401 -- side effect: loads .env into os.environ

from t_gnn.adaptive_calibration import AdaptiveDecayCalibrator  # noqa: E402
from t_gnn.api_state import ApiStateWriter, create_api_tables  # noqa: E402
from t_gnn.audit import AuditLogger, FileAuditSink  # noqa: E402
from t_gnn.cold_storage import BufferedColdStorageWriter, Neo4jColdStorageWriter, Neo4jConfig  # noqa: E402
from t_gnn.config_writer import ConfigFileWatcher  # noqa: E402
from t_gnn.data.simulate_traffic import (  # noqa: E402
    inject_admin_share_escalation,
    inject_lateral_pivot,
    inject_low_and_slow_anomaly,
)
from t_gnn.graph_store import ActiveGraphStore, ShardedActiveGraphStore  # noqa: E402
from t_gnn.metrics import MetricsCollector  # noqa: E402
from t_gnn.motif_engine import (  # noqa: E402
    MotifAlertBus,
    MotifEngine,
    MotifResetBus,
    RedisMotifStateStore,
    ShardedMotifStateStore,
)
from t_gnn.motifs import MotifRegistry  # noqa: E402
from t_gnn.protocol_registry import ProtocolDecayRegistry  # noqa: E402
from t_gnn.pruning import EpsilonController, PruneEventBus, PruningWatcher  # noqa: E402
from t_gnn.schema import Edge  # noqa: E402
from t_gnn.streaming import DecayStreamProcessor  # noqa: E402
from t_gnn.tgnn import TGNNInferenceEngine  # noqa: E402

BACKGROUND_PROTOCOLS = ("Kerberos", "SMB", "RDP")
BACKGROUND_PROTOCOL_WEIGHTS = (0.6, 0.3, 0.1)
ATTACK_KINDS = ("lateral_pivot", "admin_share_escalation", "low_and_slow")


def _neo4j_config() -> Neo4jConfig:
    return Neo4jConfig(
        uri=os.environ.get("NEO4J_URI", "bolt://localhost:7687"),
        user=os.environ.get("NEO4J_USER", "neo4j"),
        password=os.environ.get("NEO4J_PASSWORD", "devpassword123"),
    )


def _redis_client(db: int) -> "redis.Redis":
    return redis.Redis(
        host=os.environ.get("REDIS_HOST", "localhost"),
        port=int(os.environ.get("REDIS_PORT", "6379")),
        db=db,
    )


def _background_edge(rng: random.Random, user: str, home_machines: list[str], t: float) -> Edge:
    dst = rng.choice(home_machines)
    protocol = rng.choices(BACKGROUND_PROTOCOLS, weights=BACKGROUND_PROTOCOL_WEIGHTS)[0]
    w_0 = 0.6 if rng.random() < 0.02 else rng.uniform(0.95, 1.05)
    return Edge(
        src=f"User:{user}", dst=f"Machine:{dst}", edge_type="Authentication",
        protocol=protocol, t_e=t, w_0=w_0, source_system="live-synthetic",
    )


def _inject_attack(kind: str, rng: random.Random, num_users: int, machines: list[str], t: float) -> list[Edge]:
    if kind == "lateral_pivot":
        edges, _labels = inject_lateral_pivot(rng, machines, t)
        return list(edges)
    if kind == "admin_share_escalation":
        edges, _labels = inject_admin_share_escalation(rng, num_users, machines, t)
        return list(edges)
    if kind == "low_and_slow":
        edge, _label = inject_low_and_slow_anomaly(rng, num_users, machines, t)
        return [edge]
    raise ValueError(f"unknown attack kind {kind!r}")


def _restamp_now(edges: list[Edge], base: float) -> list[Edge]:
    """`--clock wall`: an injected attack's hops are generated with their
    realistic gaps (e.g. 1h between lateral_pivot's hops), which would take
    that long to play out in real time. Restamp them to *now*, in order, 1ms
    apart -- still inside every motif's window, so detection is unchanged,
    and every timestamp stays at the wall clock the dashboard measures
    against. `edge_id=None` lets `Edge.__post_init__` recompute the id from
    the new `t_e`."""
    ordered = sorted(edges, key=lambda e: e.t_e)
    return [dataclasses.replace(e, t_e=base + i * 0.001, edge_id=None) for i, e in enumerate(ordered)]


def _synthetic_edge_stream(
    rng: random.Random, num_users: int, num_machines: int, attack_every: int, clock: str = "wall",
) -> Iterator[Edge]:
    """Infinite stream: background authentication noise, with one attack
    scenario injected every `attack_every` ticks (cycling through
    `ATTACK_KINDS`). Runs until the caller stops iterating (`--max-ticks`).

    `clock` decides what `t_e` means:
      - "wall" (default): each edge is stamped with the real current time
        when it's generated. The dashboard's time ranges ("last 24h", ending
        now) always contain what the pipeline just produced. Decay plays out
        in real time, so with the default half-lives (RDP ~1h ... DNS ~8d)
        little decays during a short run -- pruning is then driven mostly by
        graph-size pressure (`--max-edges`).
      - "simulated": the original accelerated clock -- starts at now and
        advances 1-30 simulated seconds per edge (a few hundred times real
        time at the default `--tick-delay`), so decay/pruning are visible
        within minutes. Every timestamp lands in the *future*, though, so the
        dashboard's ranges won't contain the data (and health reports a
        negative snapshot age).
    """
    users = [f"u{i}" for i in range(num_users)]
    machines = [f"C{1000 + i}" for i in range(num_machines)]
    home_machines = {u: rng.sample(machines, k=min(len(machines), rng.randint(1, 3))) for u in users}
    attack_cycle = itertools.cycle(ATTACK_KINDS)
    wall = clock == "wall"

    sim_t = time.time()
    tick = 0
    while True:
        tick += 1
        if wall:
            # Strictly increasing, not just monotonic: `edge_id` hashes t_e,
            # so two same-src/dst/protocol edges sharing a clock reading
            # (Windows' clock is coarse) would collide and silently merge in
            # the graph store. Also survives the system clock stepping back.
            sim_t = max(sim_t + 1e-3, time.time())
        if tick % attack_every == 0:
            kind = next(attack_cycle)
            print(f"[t={sim_t:.0f}] [ATTACK] injecting {kind}")
            injected = _inject_attack(kind, rng, num_users, machines, sim_t)
            if wall:
                injected = _restamp_now(injected, sim_t)
            yield from injected
            sim_t = max([sim_t] + [e.t_e for e in injected])
            if not wall:
                sim_t += rng.uniform(1.0, 30.0)
        else:
            user = rng.choice(users)
            edge = _background_edge(rng, user, home_machines[user], sim_t)
            yield edge
            if not wall:
                sim_t += rng.uniform(1.0, 30.0)


def _replay_edge_stream(staged_dir: Path) -> Iterator[Edge]:
    """Finite stream: replays a staged directory's edges in timestamp order
    (`stage_lanl.py`, `simulate_traffic.py`, or any other producer of the
    shared shard-*.jsonl format -- e.g. Backlog B.8's `stage_mordor.py` on
    the separate `feature/mordor-ingestion` branch). Ends once every staged
    edge has been yielded, rather than running until Ctrl+C."""
    edges: list[Edge] = []
    for shard in sorted(Path(staged_dir).glob("shard-*.jsonl")):
        for line in shard.read_text(encoding="utf-8").splitlines():
            if line.strip():
                edges.append(Edge.from_json(line))
    edges.sort(key=lambda e: e.t_e)
    print(f"loaded {len(edges)} staged edges from {staged_dir}")
    yield from edges


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", choices=("synthetic", "replay"), default="synthetic",
                         help="synthetic: continuously generate traffic (default). replay: replay a staged directory once, in timestamp order.")
    parser.add_argument("--staged-dir", type=Path, default=None, help="required with --source replay")
    parser.add_argument("--num-users", type=int, default=30, help="synthetic mode only")
    parser.add_argument("--num-machines", type=int, default=10, help="synthetic mode only")
    parser.add_argument("--tick-delay", type=float, default=0.05, help="wall-clock seconds to sleep between edges (human pacing only)")
    parser.add_argument("--attack-every", type=int, default=30, help="synthetic mode only: inject one attack scenario every N ticks")
    parser.add_argument("--clock", choices=("wall", "simulated"), default="wall",
                         help="synthetic mode only: 'wall' (default) stamps edges with the real current time, so the "
                              "dashboard's time ranges show the data; 'simulated' runs an accelerated clock "
                              "(visible decay/pruning in minutes, but timestamps land in the future)")
    parser.add_argument("--metrics-every", type=int, default=25, help="run a pruning + inference pass and print a metrics snapshot every N ticks")
    parser.add_argument("--z-threshold", type=float, default=3.0, help="|z-score| to print as an anomaly")
    parser.add_argument("--epsilon-min", type=float, default=0.05)
    parser.add_argument("--epsilon-max", type=float, default=0.4)
    parser.add_argument("--max-edges", type=int, default=5000, help="graph-size ceiling feeding EpsilonController's size pressure")
    parser.add_argument("--fuzzy", action="store_true", help="enable MotifEngine's fuzzy/probabilistic matching mode (Backlog B.4)")
    parser.add_argument("--min-confidence", type=float, default=0.5, help="only used with --fuzzy")
    parser.add_argument("--shards", type=int, default=1, help="use N shards for the graph store + motif cache (Backlog B.5); N=1 is the plain Phase 2/3 path")
    parser.add_argument("--adaptive-calibration", action="store_true", help="enable AdaptiveDecayCalibrator (Backlog B.3)")
    parser.add_argument("--audit-log", type=Path, default=Path("logs/audit.log"))
    parser.add_argument("--no-api-persist", action="store_true",
                         help="disable writing to the frontend API layer's Postgres tables (tasks.md F0) -- "
                              "on by default, degrades gracefully (a warning, not a crash) if Postgres is unreachable")
    parser.add_argument("--config-reload-interval", type=float, default=2.0,
                         help="seconds between checks for edits to config/protocols.yaml + motifs.yaml "
                              "(hot reload, Frontend Backlog FB.1); 0 disables")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-ticks", type=int, default=None, help="synthetic mode only: stop after N ticks instead of running until Ctrl+C")
    args = parser.parse_args()

    if args.source == "replay" and args.staged_dir is None:
        parser.error("--source replay requires --staged-dir")

    print("== Protocol-Aware CTDG pipeline: live driver ==")

    try:
        neo4j_writer = Neo4jColdStorageWriter(_neo4j_config())
    except Exception as exc:
        print(f"ERROR: could not connect to Neo4j ({exc}).", file=sys.stderr)
        print("Run `docker compose up -d` first, then retry.", file=sys.stderr)
        sys.exit(1)
    print("connected to Neo4j (cold storage).")

    redis_clients = [_redis_client(db=i) for i in range(args.shards)]
    try:
        redis_clients[0].ping()
        print(f"connected to Redis (motif cache, {args.shards} shard(s)).")
    except Exception as exc:
        print(f"WARNING: could not reach Redis ({exc}) -- motif detection will degrade gracefully "
              f"(tasks.md 6.3) and stay disabled until it's reachable.", file=sys.stderr)

    registry = ProtocolDecayRegistry()
    processor = DecayStreamProcessor(registry=registry)
    calibrator = AdaptiveDecayCalibrator(registry=registry) if args.adaptive_calibration else None

    store = ShardedActiveGraphStore(args.shards) if args.shards > 1 else ActiveGraphStore()

    buffered_writer = BufferedColdStorageWriter(neo4j_writer)
    buffered_writer.start()

    prune_bus = PruneEventBus()
    alert_bus = MotifAlertBus()
    reset_bus = MotifResetBus()

    def _on_prune(event):
        print(f"[t={event.pruned_at:.0f}] PRUNE       {event.edge.src} -> {event.edge.dst} "
              f"({event.edge.protocol}) w_at_prune={event.w_at_prune:.4f}")

    def _on_motif_alert(event):
        tag = f" (confidence={event.confidence:.2f})" if event.confidence < 1.0 else ""
        print(f"[t={event.completed_at:.0f}] *** MOTIF ALERT *** {event.motif_name}  "
              f"chain_key={event.chain_key}{tag}")

    def _on_motif_reset(event):
        print(f"[t={event.reset_at:.0f}] MOTIF RESET {event.motif_name}  chain_key={event.chain_key}  "
              f"(edge {event.triggering_edge_id} pruned)")

    prune_bus.subscribe(_on_prune)
    alert_bus.subscribe(_on_motif_alert)
    reset_bus.subscribe(_on_motif_reset)

    motif_state_store = (
        ShardedMotifStateStore([RedisMotifStateStore(c) for c in redis_clients])
        if args.shards > 1
        else RedisMotifStateStore(redis_clients[0])
    )
    motif_registry = MotifRegistry()
    motif_engine = MotifEngine(
        definitions=motif_registry.all(),
        state_store=motif_state_store,
        alert_bus=alert_bus,
        prune_event_bus=prune_bus,
        reset_bus=reset_bus,
        fuzzy=args.fuzzy,
        min_confidence=args.min_confidence,
    )

    epsilon_controller = EpsilonController(epsilon_min=args.epsilon_min, epsilon_max=args.epsilon_max, max_edges=args.max_edges)
    watcher = PruningWatcher(
        store=store, decay_engine=processor.decay_engine, epsilon_controller=epsilon_controller,
        cold_storage=buffered_writer, event_bus=prune_bus,
    )

    inference_engine = TGNNInferenceEngine(store=store, alert_bus=alert_bus)

    metrics = MetricsCollector(store=store, prune_bus=prune_bus, alert_bus=alert_bus, reset_bus=reset_bus)
    audit_logger = AuditLogger(sink=FileAuditSink(args.audit_log), prune_bus=prune_bus, reset_bus=reset_bus)

    api_state_writer: Optional[ApiStateWriter] = None
    if not args.no_api_persist:
        try:
            with t_gnn.db.get_connection() as conn:
                create_api_tables(conn)
            api_state_writer = ApiStateWriter(
                t_gnn.db.get_connection, alert_bus=alert_bus, reset_bus=reset_bus,
                result_bus=inference_engine.result_bus,
            )
            print("connected to Postgres (frontend API layer, tasks.md F0).")
        except Exception as exc:
            print(f"WARNING: could not reach Postgres ({exc}) -- frontend API history persistence "
                  f"disabled for this run (run `python scripts/init_postgres.py` first if the database "
                  f"itself doesn't exist yet).", file=sys.stderr)

    print(f"source={args.source} shards={args.shards} fuzzy={args.fuzzy} "
          f"adaptive_calibration={args.adaptive_calibration}")
    print(f"audit log: {args.audit_log}")

    rng = random.Random(args.seed)
    if args.source == "replay":
        edge_stream = _replay_edge_stream(args.staged_dir)
        print("replaying staged edges once -- stops automatically when exhausted\n")
    else:
        edge_stream = _synthetic_edge_stream(rng, args.num_users, args.num_machines, args.attack_every, clock=args.clock)
        print(f"users={args.num_users} machines={args.num_machines} clock={args.clock}")
        if args.clock == "simulated":
            print("WARNING: --clock simulated runs time a few hundred times faster than real time, so every "
                  "timestamp lands in the future -- the dashboard's time ranges (e.g. 'last 24h') won't "
                  "contain this data. Use --clock wall (the default) to watch it in the dashboard.",
                  file=sys.stderr)
        print("running -- Ctrl+C to stop\n")

    sim_t: Optional[float] = None
    tick = 0

    def _process_edge(edge: Edge) -> None:
        metrics.observe_edge_processed()
        processed = processor.process(edge, t=edge.t_e)
        store.upsert(processed.edge)
        inference_engine.observe_deviation(processed.deviation)
        deviation = processed.deviation
        if deviation.z_score is not None and abs(deviation.z_score) >= args.z_threshold:
            print(f"[t={edge.t_e:.0f}] ANOMALY     {deviation.entity} protocol={deviation.protocol} "
                  f"z={deviation.z_score:.2f}")
        motif_engine.on_edge(edge)
        if calibrator is not None:
            for event in calibrator.observe(edge):
                print(f"[t={event.t:.0f}] RECALIBRATE {event.protocol} lambda_p "
                      f"{event.previous_lambda_p:.6g} -> {event.applied_lambda_p:.6g}")

    def _run_metrics_pass(t: float) -> None:
        prune_stats = watcher.run_once(t=t)
        metrics.observe_pruning_pass(prune_stats, t=t)

        start = time.perf_counter()
        results = inference_engine.run_once(t=t)
        latency = time.perf_counter() - start
        metrics.observe_inference_pass(results, latency, t=t, trigger="scheduled")

        snap = metrics.snapshot(now=t)
        if api_state_writer is not None:
            api_state_writer.record_metrics_snapshot(snap, t=t)
        print(
            f"[t={t:.0f}] metrics: graph_size={snap.active_graph_size} "
            f"prune_rate={snap.prune_rate_per_second:.2f}/s epsilon={snap.epsilon:.4f} "
            f"motif_hit_rate={snap.motif_hit_rate_per_second:.2f}/s "
            f"motif_reset_rate={snap.motif_reset_rate_per_second:.2f}/s "
            f"inference_latency={snap.latest_inference_latency_seconds * 1000:.2f}ms "
            f"redis_available={motif_engine.available}"
        )

    # Frontend Backlog FB.1: pick up config edits (the dashboard's, or by hand)
    # without a restart. The decay engine reads `registry` live, so a protocol
    # reload applies to the next edge -- and replaces any in-memory
    # AdaptiveDecayCalibrator values with the file's (the file wins). Motif
    # definitions are a list the engine holds, so they're swapped in; chains
    # already in progress keep the TTL they were written with, new writes use
    # the new window.
    config_watcher = ConfigFileWatcher(
        registry, motif_registry,
        on_motifs_reloaded=lambda reloaded: setattr(motif_engine, "definitions", reloaded.all()),
    )
    next_config_check = time.monotonic() + args.config_reload_interval

    try:
        for edge in edge_stream:
            tick += 1
            _process_edge(edge)
            sim_t = edge.t_e

            if args.config_reload_interval > 0 and time.monotonic() >= next_config_check:
                config_watcher.check()
                next_config_check = time.monotonic() + args.config_reload_interval

            if tick % args.metrics_every == 0:
                _run_metrics_pass(sim_t)

            time.sleep(args.tick_delay)

            if args.max_ticks is not None and tick >= args.max_ticks:
                break
    except KeyboardInterrupt:
        print("\nshutting down...")
    finally:
        if sim_t is not None:
            _run_metrics_pass(sim_t)  # final flush, so the closing snapshot reflects the true end state
        buffered_writer.stop(timeout=5.0)
        neo4j_writer.close()
        print(f"processed {tick} edge(s)")
        print(f"cold-storage records dropped after retries: {buffered_writer.dropped}")


if __name__ == "__main__":
    main()
