"""The Flink streaming job for decay + baseline deviation (Backlog B.1, design.md 2.1-2.3).

Runs inside the `t-gnn-flink` image only (PyFlink 1.18 needs Python <= 3.10);
submit it with `python scripts/submit_flink_job.py` from the host.

    edges topic --key_by(src|protocol)--> DecayBaselineFunction <--broadcast-- lambdas topic
                                            |  "d": decayed edge + deviation -> decayed topic
                                            |  "w": timer-driven w(e,t) re-evaluations -> weights topic

`DecayBaselineFunction` is one operator (Backlog B.11), keyed by (entity,
protocol). It used to be two: decay keyed by edge id (design.md 2.1's
layout), then a re-key to (entity, protocol) for the baseline. Keyed by edge
id, every edge was a new state key, so state never stayed hot, and the
re-key cost a second Python<->JVM hop per edge. B.7's benchmark found the
decay operator 100% busy at ~600 edges/s. Fusing them on the baseline's key
keeps both kinds of state warm and drops the hop:

- decay (design.md 2.1/2.2): lambda_p per protocol lives in Flink broadcast
  state, filled from a compacted Kafka topic, so a lambda_p change reaches
  every task without a redeploy or a per-process YAML reload. Each live edge
  is re-evaluated on event-time timers -- every `--refresh-interval`
  seconds, plus exactly at the moment w falls to `--expire-below`, after
  which it's dropped. A key's live edges sit in refresh buckets by due time
  (MapState), so a firing timer touches only the edges due then.
- baseline (design.md 2.3): the EWMA baseline per (entity, protocol), as
  keyed state.

Event time is the edge's own `t_e`, so the decayed output is exactly what
`DecayStreamProcessor.process(edge, t=edge.t_e)` computes in-process (what
scripts/run_pipeline.py does), and timers advance with the stream's data
rather than the wall clock: a replay of week-old edges decays them by their
own clock, and timers stop when edges stop arriving.

An edge whose protocol has no published lambda_p (and no default published
either -- i.e. nothing has been published yet) is held in its key's pending
list and retried on a processing-time timer rather than decayed with a
guessed constant. Later edges for that key queue behind it, so the baseline
still sees them in arrival order.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time

from pyflink.common import Configuration, Duration, Types, WatermarkStrategy
from pyflink.common.serialization import SimpleStringSchema
from pyflink.common.watermark_strategy import TimestampAssigner
from pyflink.datastream import StreamExecutionEnvironment, TimeDomain
from pyflink.datastream.connectors.base import DeliveryGuarantee
from pyflink.datastream.connectors.kafka import (
    KafkaOffsetResetStrategy,
    KafkaOffsetsInitializer,
    KafkaRecordSerializationSchema,
    KafkaSink,
    KafkaSource,
)
from pyflink.datastream.functions import KeyedBroadcastProcessFunction
from pyflink.datastream.state import MapStateDescriptor, ValueStateDescriptor

from t_gnn.baseline import DEFAULT_ALPHA
from t_gnn.flink.logic import (
    DECAYED_TOPIC,
    EDGES_TOPIC,
    JOB_NAME,
    LAMBDAS_TOPIC,
    WEIGHTS_TOPIC,
    bucket_add,
    bucket_entries,
    ingest_edge,
    next_refresh_time,
    parse_lambda_record,
    pending_add,
    pending_edges,
    raw_key,
    reevaluate,
    resolve_lambda,
    to_millis,
)
from t_gnn.schema import Edge

LAMBDAS_STATE = MapStateDescriptor("lambdas", Types.STRING(), Types.DOUBLE())
# The operator's one output stream carries both kinds of record, tagged by
# their first character, and two chained filters split it. Not a side output:
# in thread mode PyFlink 1.18 mishandles a side output emitted from on_timer
# (it reaches the main output as a raw tuple and the String serializer throws
# ClassCastException), which crash-looped the job.
DECAYED_KIND = "d"
WEIGHT_KIND = "w"
PENDING_RETRY_MS = 1000


class EdgeTimestampAssigner(TimestampAssigner):
    def extract_timestamp(self, value, record_timestamp) -> int:
        return to_millis(json.loads(value)["t_e"])


class _BroadcastLambdas:
    """Read-only view of broadcast state as the Mapping `resolve_lambda()` takes."""

    def __init__(self, state) -> None:
        self._state = state

    def __contains__(self, key) -> bool:
        return self._state.contains(key)

    def __getitem__(self, key) -> float:
        return self._state.get(key)

    def get(self, key, default=None):
        return self._state.get(key) if self._state.contains(key) else default


class DecayBaselineFunction(KeyedBroadcastProcessFunction):
    def __init__(self, refresh_interval: float, expire_below: float, alpha: float) -> None:
        self.refresh_interval = refresh_interval
        self.expire_below = expire_below
        self.alpha = alpha

    def open(self, runtime_context) -> None:
        self.baseline = runtime_context.get_state(ValueStateDescriptor("baseline", Types.STRING()))
        self.pending = runtime_context.get_state(ValueStateDescriptor("pending", Types.STRING()))
        # due time (event-time ms) -> the key's edges to re-evaluate then
        self.due = runtime_context.get_map_state(MapStateDescriptor("due", Types.LONG(), Types.STRING()))

    def _lambda(self, ctx, protocol: str):
        return resolve_lambda(_BroadcastLambdas(ctx.get_broadcast_state(LAMBDAS_STATE)), protocol)

    def _schedule(self, edge: Edge, lambda_p: float, due_ms: int, ctx) -> None:
        raw = self.due.get(due_ms) if self.due.contains(due_ms) else None
        self.due.put(due_ms, bucket_add(raw, edge, lambda_p))
        if raw is None:
            ctx.timer_service().register_event_time_timer(due_ms)

    def _ingest(self, edge: Edge, lambda_p: float, ctx):
        state, record = ingest_edge(edge, lambda_p, self.baseline.value(), alpha=self.alpha)
        self.baseline.update(state)
        yield DECAYED_KIND + record
        if self.refresh_interval > 0:
            next_t = next_refresh_time(edge, edge.t_e, lambda_p, self.refresh_interval, self.expire_below)
            if math.isfinite(next_t):
                self._schedule(edge, lambda_p, to_millis(next_t), ctx)

    def process_element(self, value, ctx):
        edge = Edge.from_json(value)
        waiting = self.pending.value()
        lambda_p = None if waiting else self._lambda(ctx, edge.protocol)
        if lambda_p is None:
            self.pending.update(pending_add(waiting, edge))
            if not waiting:
                # Wall-clock ms is what processing time is. Not
                # ctx.current_processing_time(): in thread mode that call
                # crash-looped the job on a freshly started second
                # taskmanager (pemja: "error return without exception set").
                ctx.timer_service().register_processing_time_timer(int(time.time() * 1000) + PENDING_RETRY_MS)
            return
        yield from self._ingest(edge, lambda_p, ctx)

    def process_broadcast_element(self, value, ctx):
        protocol, lambda_p = parse_lambda_record(value)
        ctx.get_broadcast_state(LAMBDAS_STATE).put(protocol, lambda_p)

    def on_timer(self, timestamp, ctx):
        if ctx.time_domain() == TimeDomain.PROCESSING_TIME:
            waiting = pending_edges(self.pending.value())
            if not waiting:
                return
            # one key = one protocol, so one lambda_p covers the whole list
            lambda_p = self._lambda(ctx, waiting[0].protocol)
            if lambda_p is None:
                ctx.timer_service().register_processing_time_timer(timestamp + PENDING_RETRY_MS)
                return
            self.pending.clear()
            for edge in waiting:
                yield from self._ingest(edge, lambda_p, ctx)
            return

        # Event-time refresh of every edge due now. The broadcast value wins,
        # so a hot-reloaded lambda_p applies from the next re-evaluation on.
        if not self.due.contains(timestamp):
            return
        entries = bucket_entries(self.due.get(timestamp))
        self.due.remove(timestamp)
        t = timestamp / 1000.0
        for edge, tracked_lambda in entries:
            lambda_p = self._lambda(ctx, edge.protocol)
            if lambda_p is None:
                lambda_p = tracked_lambda
            record, next_t = reevaluate(edge, t, lambda_p, self.refresh_interval, self.expire_below)
            yield WEIGHT_KIND + record
            if next_t is not None:
                self._schedule(edge, lambda_p, max(to_millis(next_t), timestamp + 1), ctx)


def _source(bootstrap: str, topic: str, group_id: str, starting_offsets) -> KafkaSource:
    return (
        KafkaSource.builder()
        .set_bootstrap_servers(bootstrap)
        .set_topics(topic)
        .set_group_id(group_id)
        .set_starting_offsets(starting_offsets)
        .set_value_only_deserializer(SimpleStringSchema())
        .build()
    )


def _sink(bootstrap: str, topic: str) -> KafkaSink:
    return (
        KafkaSink.builder()
        .set_bootstrap_servers(bootstrap)
        .set_record_serializer(
            KafkaRecordSerializationSchema.builder()
            .set_topic(topic)
            .set_value_serialization_schema(SimpleStringSchema())
            .build()
        )
        .set_delivery_guarantee(DeliveryGuarantee.AT_LEAST_ONCE)
        .build()
    )


def build(env: StreamExecutionEnvironment, args: argparse.Namespace) -> None:
    edge_watermarks = (
        WatermarkStrategy.for_bounded_out_of_orderness(Duration.of_millis(to_millis(args.out_of_orderness)))
        .with_timestamp_assigner(EdgeTimestampAssigner())
    )
    # The event-time assigner goes on assign_timestamps_and_watermarks(), not
    # from_source(): PyFlink silently ignores a Python TimestampAssigner passed
    # to from_source() and falls back to the Kafka record timestamp (the
    # producer's wall clock), which made every timer fire at once.
    edges = env.from_source(
        # Committed offsets (on checkpoint), so a restarted job resumes where it
        # stopped; a first-ever start reads only new edges unless told otherwise.
        _source(args.bootstrap_servers, args.edges_topic, f"{args.job_name}-edges",
                KafkaOffsetsInitializer.committed_offsets(
                    KafkaOffsetResetStrategy.EARLIEST if args.edges_from == "earliest" else KafkaOffsetResetStrategy.LATEST
                )),
        WatermarkStrategy.no_watermarks(), "edges",
    ).assign_timestamps_and_watermarks(edge_watermarks)
    # Always from the beginning of the compacted topic, so every (re)start
    # rebuilds the full broadcast state. Idleness keeps this mostly-silent
    # input from holding back the connected operator's watermark.
    lambdas = env.from_source(
        _source(args.bootstrap_servers, args.lambdas_topic, f"{args.job_name}-lambdas", KafkaOffsetsInitializer.earliest()),
        WatermarkStrategy.for_monotonous_timestamps().with_idleness(Duration.of_millis(to_millis(args.idleness))),
        "lambdas",
    )

    tagged = (
        edges.key_by(raw_key, key_type=Types.STRING())
        .connect(lambdas.broadcast(LAMBDAS_STATE))
        .process(DecayBaselineFunction(args.refresh_interval, args.expire_below, args.alpha), output_type=Types.STRING())
        .name("decay-baseline")
    )

    def of_kind(kind: str):
        return (
            tagged.filter(lambda value: value[0] == kind).name(f"{kind}-filter")
            .map(lambda value: value[1:], output_type=Types.STRING()).name(f"{kind}-untag")
        )

    of_kind(WEIGHT_KIND).sink_to(_sink(args.bootstrap_servers, args.weights_topic)).name("weights-sink")
    of_kind(DECAYED_KIND).sink_to(_sink(args.bootstrap_servers, args.decayed_topic)).name("decayed-sink")


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bootstrap-servers", default="kafka:29092")
    parser.add_argument("--job-name", default=JOB_NAME)
    parser.add_argument("--edges-from", choices=("latest", "earliest"), default="latest",
                        help="where a first-ever start (no committed offsets) begins reading the edges topic")
    parser.add_argument("--edges-topic", default=EDGES_TOPIC)
    parser.add_argument("--lambdas-topic", default=LAMBDAS_TOPIC)
    parser.add_argument("--decayed-topic", default=DECAYED_TOPIC)
    parser.add_argument("--weights-topic", default=WEIGHTS_TOPIC)
    parser.add_argument("--refresh-interval", type=float, default=3600.0,
                        help="event-time seconds between w(e,t) re-evaluations of a live edge; 0 disables them")
    parser.add_argument("--expire-below", type=float, default=0.05,
                        help="stop re-evaluating an edge once w(e,t) falls to this (the default epsilon_min)")
    parser.add_argument("--out-of-orderness", type=float, default=5.0, help="seconds of edge lateness the watermark allows")
    parser.add_argument("--idleness", type=float, default=5.0, help="seconds before a silent input stops holding back the watermark")
    parser.add_argument("--alpha", type=float, default=DEFAULT_ALPHA, help="EWMA smoothing factor")
    parser.add_argument("--parallelism", type=int, default=1)
    parser.add_argument("--checkpoint-interval", type=float, default=10.0, help="seconds")
    parser.add_argument("--execution-mode", choices=("thread", "process"), default="thread",
                        help="PyFlink's Python execution mode. 'thread' runs the operators inside the JVM "
                             "(pemja) and was ~4x faster here on keyed-state access than 'process' (a separate "
                             "Python worker over gRPC) -- Backlog B.7's measurements")
    return parser.parse_args(argv)


def main(argv=None) -> None:
    args = parse_args(argv)
    config = Configuration()
    config.set_string("python.execution-mode", args.execution_mode)
    env = StreamExecutionEnvironment.get_execution_environment(config)
    env.set_parallelism(args.parallelism)
    env.enable_checkpointing(to_millis(args.checkpoint_interval))
    build(env, args)
    env.execute(args.job_name)


if __name__ == "__main__":
    main(sys.argv[1:])
