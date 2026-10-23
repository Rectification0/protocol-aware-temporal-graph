"""The Flink streaming job for decay + baseline deviation (Backlog B.1, design.md 2.1-2.3).

Runs inside the `t-gnn-flink` image only (PyFlink 1.18 needs Python <= 3.10);
submit it with `python scripts/submit_flink_job.py` from the host.

    edges topic --key_by(edge_id)--> DecayFunction <--broadcast-- lambdas topic
                                       |  main: edge refreshed at t_e
                                       |  side: timer-driven w(e,t) re-evaluations -> weights topic
                                       v
                      key_by(src|protocol) --> BaselineFunction --> decayed topic

- `DecayFunction` (design.md 2.1/2.2) holds lambda_p per protocol in Flink
  broadcast state, filled from a compacted Kafka topic, so a lambda_p change
  reaches every task without a redeploy or a per-process YAML reload. It
  keeps each live edge in keyed state and re-evaluates w(e,t) on event-time
  timers -- every `--refresh-interval` seconds, plus exactly at the moment
  w falls to `--expire-below`, after which the edge's state is dropped.
- `BaselineFunction` (design.md 2.3) is the EWMA baseline as Flink keyed
  state per (entity, protocol).

Event time is the edge's own `t_e`, so the decayed output is exactly what
`DecayStreamProcessor.process(edge, t=edge.t_e)` computes in-process (what
scripts/run_pipeline.py does), and timers advance with the stream's data
rather than the wall clock: a replay of week-old edges decays them by their
own clock, and timers stop when edges stop arriving.

An edge whose protocol has no published lambda_p (and no default published
either -- i.e. nothing has been published yet) is held in state and retried
on a processing-time timer rather than decayed with a guessed constant.
"""

from __future__ import annotations

import argparse
import json
import math
import sys

from pyflink.common import Duration, Types, WatermarkStrategy
from pyflink.common.serialization import SimpleStringSchema
from pyflink.common.watermark_strategy import TimestampAssigner
from pyflink.datastream import OutputTag, StreamExecutionEnvironment, TimeDomain
from pyflink.datastream.connectors.base import DeliveryGuarantee
from pyflink.datastream.connectors.kafka import (
    KafkaOffsetResetStrategy,
    KafkaOffsetsInitializer,
    KafkaRecordSerializationSchema,
    KafkaSink,
    KafkaSource,
)
from pyflink.datastream.functions import KeyedBroadcastProcessFunction, KeyedProcessFunction
from pyflink.datastream.state import MapStateDescriptor, ValueStateDescriptor

from t_gnn.baseline import DEFAULT_ALPHA
from t_gnn.flink.logic import (
    DECAYED_TOPIC,
    EDGES_TOPIC,
    JOB_NAME,
    LAMBDAS_TOPIC,
    WEIGHTS_TOPIC,
    baseline_key,
    decayed_record,
    next_refresh_time,
    observe_from_state,
    parse_lambda_record,
    refresh_at_ingest,
    resolve_lambda,
    to_millis,
    weight_record,
)
from t_gnn.schema import Edge

LAMBDAS_STATE = MapStateDescriptor("lambdas", Types.STRING(), Types.DOUBLE())
WEIGHTS_TAG = OutputTag("weights", Types.STRING())
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


class DecayFunction(KeyedBroadcastProcessFunction):
    def __init__(self, refresh_interval: float, expire_below: float) -> None:
        self.refresh_interval = refresh_interval
        self.expire_below = expire_below

    def open(self, runtime_context) -> None:
        self.edge_state = runtime_context.get_state(ValueStateDescriptor("edge", Types.STRING()))
        self.pending_state = runtime_context.get_state(ValueStateDescriptor("pending", Types.BOOLEAN()))
        self.lambda_state = runtime_context.get_state(ValueStateDescriptor("lambda_p", Types.DOUBLE()))

    def _lambda(self, ctx, protocol: str):
        return resolve_lambda(_BroadcastLambdas(ctx.get_broadcast_state(LAMBDAS_STATE)), protocol)

    def _ingest(self, edge: Edge, lambda_p: float, ctx):
        self.lambda_state.update(lambda_p)
        yield refresh_at_ingest(edge, lambda_p).to_json()
        if self.refresh_interval > 0:
            next_t = next_refresh_time(edge, edge.t_e, lambda_p, self.refresh_interval, self.expire_below)
            if math.isfinite(next_t):
                self.edge_state.update(edge.to_json())
                ctx.timer_service().register_event_time_timer(to_millis(next_t))

    def process_element(self, value, ctx):
        edge = Edge.from_json(value)
        lambda_p = self._lambda(ctx, edge.protocol)
        if lambda_p is None:
            self.edge_state.update(edge.to_json())
            self.pending_state.update(True)
            ctx.timer_service().register_processing_time_timer(ctx.current_processing_time() + PENDING_RETRY_MS)
            return
        yield from self._ingest(edge, lambda_p, ctx)

    def process_broadcast_element(self, value, ctx):
        protocol, lambda_p = parse_lambda_record(value)
        ctx.get_broadcast_state(LAMBDAS_STATE).put(protocol, lambda_p)

    def on_timer(self, timestamp, ctx):
        raw = self.edge_state.value()
        if raw is None:
            return
        edge = Edge.from_json(raw)

        if ctx.time_domain() == TimeDomain.PROCESSING_TIME:
            if not self.pending_state.value():
                return
            lambda_p = self._lambda(ctx, edge.protocol)
            if lambda_p is None:
                ctx.timer_service().register_processing_time_timer(timestamp + PENDING_RETRY_MS)
                return
            self.pending_state.clear()
            self.edge_state.clear()
            yield from self._ingest(edge, lambda_p, ctx)
            return

        # Event-time refresh. The broadcast value wins, so a hot-reloaded
        # lambda_p applies from the next re-evaluation on.
        lambda_p = self._lambda(ctx, edge.protocol)
        if lambda_p is None:
            lambda_p = self.lambda_state.value()
        self.lambda_state.update(lambda_p)
        t = timestamp / 1000.0
        record, expired = weight_record(edge, t, lambda_p, self.expire_below)
        yield WEIGHTS_TAG, json.dumps(record)
        if expired:
            self.edge_state.clear()
            self.lambda_state.clear()
            return
        next_t = next_refresh_time(edge, t, lambda_p, self.refresh_interval, self.expire_below)
        if math.isfinite(next_t):
            ctx.timer_service().register_event_time_timer(max(to_millis(next_t), timestamp + 1))


class BaselineFunction(KeyedProcessFunction):
    def __init__(self, alpha: float) -> None:
        self.alpha = alpha

    def open(self, runtime_context) -> None:
        self.baseline_state = runtime_context.get_state(ValueStateDescriptor("baseline", Types.STRING()))

    def process_element(self, value, ctx):
        edge = Edge.from_json(value)
        new_state, signal = observe_from_state(self.baseline_state.value(), edge, alpha=self.alpha)
        self.baseline_state.update(new_state)
        yield decayed_record(edge, signal)


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

    decayed = (
        edges.key_by(lambda value: Edge.from_json(value).edge_id, key_type=Types.STRING())
        .connect(lambdas.broadcast(LAMBDAS_STATE))
        .process(DecayFunction(args.refresh_interval, args.expire_below), output_type=Types.STRING())
        .name("decay")
    )
    decayed.get_side_output(WEIGHTS_TAG).sink_to(_sink(args.bootstrap_servers, args.weights_topic)).name("weights-sink")
    (
        decayed.key_by(lambda value: baseline_key(Edge.from_json(value)), key_type=Types.STRING())
        .process(BaselineFunction(args.alpha), output_type=Types.STRING())
        .name("baseline")
        .sink_to(_sink(args.bootstrap_servers, args.decayed_topic))
        .name("decayed-sink")
    )


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
    return parser.parse_args(argv)


def main(argv=None) -> None:
    args = parse_args(argv)
    env = StreamExecutionEnvironment.get_execution_environment()
    env.set_parallelism(args.parallelism)
    env.enable_checkpointing(to_millis(args.checkpoint_interval))
    build(env, args)
    env.execute(args.job_name)


if __name__ == "__main__":
    main(sys.argv[1:])
