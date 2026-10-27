"""Host-side Kafka plumbing for the Flink decay/baseline job (Backlog B.1).

Needs the optional `confluent-kafka` dependency (`pip install -e ".[flink]"`)
and the compose stack's Kafka (`docker compose up -d`, localhost:9092).

    python -m t_gnn.flink.kafka_io publish-lambdas   # push config/protocols.yaml into the job's broadcast state
"""

from __future__ import annotations

import argparse
import os
import time
from typing import Iterable, Iterator, Mapping, Optional

from confluent_kafka import OFFSET_END, Consumer, KafkaException, Producer, TopicPartition
from confluent_kafka.admin import AdminClient, NewTopic

from t_gnn.flink.logic import DECAYED_TOPIC, EDGES_TOPIC, LAMBDAS_TOPIC, WEIGHTS_TOPIC, lambda_records
from t_gnn.protocol_registry import ProtocolDecayRegistry
from t_gnn.schema import Edge

DEFAULT_BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")


def ensure_topics(
    bootstrap: str = DEFAULT_BOOTSTRAP,
    lambdas_topic: str = LAMBDAS_TOPIC,
    stream_topics: Iterable[str] = (EDGES_TOPIC, DECAYED_TOPIC, WEIGHTS_TOPIC),
    timeout: float = 10.0,
    partitions: Optional[Mapping[str, int]] = None,
) -> None:
    """Create the job's topics if missing. The lambdas topic is compacted:
    only the newest lambda_p per protocol matters, and the job re-reads the
    whole topic on every start to rebuild its broadcast state.

    One partition per topic unless `partitions` says otherwise (Backlog
    B.11): give the edges topic one per job subtask, so each source subtask
    parses its own share instead of one doing all of it. Edges are produced
    keyed by `src`, so every (entity, protocol) key still arrives in order.
    An existing topic is left as it is: adding partitions later would move
    keys between them mid-stream."""
    partitions = partitions or {}
    admin = AdminClient({"bootstrap.servers": bootstrap})
    existing = set(admin.list_topics(timeout=timeout).topics)
    wanted = [
        NewTopic(lambdas_topic, num_partitions=1, replication_factor=1, config={"cleanup.policy": "compact"}),
        *(NewTopic(t, num_partitions=partitions.get(t, 1), replication_factor=1) for t in stream_topics),
    ]
    missing = [t for t in wanted if t.topic not in existing]
    for future in admin.create_topics(missing).values() if missing else ():
        try:
            future.result(timeout=timeout)
        except KafkaException as exc:
            if "TOPIC_ALREADY_EXISTS" not in str(exc):
                raise


def make_producer(bootstrap: str = DEFAULT_BOOTSTRAP) -> Producer:
    return Producer({"bootstrap.servers": bootstrap, "linger.ms": 5})


def publish_lambdas(producer: Producer, registry: ProtocolDecayRegistry, topic: str = LAMBDAS_TOPIC) -> int:
    """Publish every lambda_p in `registry` (default included); returns how many."""
    records = lambda_records(registry, published_at=time.time())
    for key, value in records:
        producer.produce(topic, key=key, value=value)
    producer.flush(10.0)
    return len(records)


def produce_edge(producer: Producer, edge: Edge, topic: str = EDGES_TOPIC) -> None:
    producer.produce(topic, key=edge.src, value=edge.to_json())
    producer.poll(0)


def tail_consumer(topics: Iterable[str], bootstrap: str = DEFAULT_BOOTSTRAP) -> Consumer:
    """A consumer positioned at the current end of `topics`' partition 0,
    so it sees only records produced from now on (no consumer-group offsets)."""
    consumer = Consumer({
        "bootstrap.servers": bootstrap,
        "group.id": f"t-gnn-tail-{os.getpid()}-{time.time_ns()}",
        "enable.auto.commit": False,
    })
    consumer.assign([TopicPartition(t, 0, OFFSET_END) for t in topics])
    # Resolve OFFSET_END now, before anything is produced, rather than at first poll.
    for tp in consumer.assignment():
        consumer.seek(TopicPartition(tp.topic, tp.partition, _high_watermark(consumer, tp)))
    return consumer


def _high_watermark(consumer: Consumer, tp: TopicPartition, timeout: float = 15.0) -> int:
    # A just-created topic has no partition leader for a moment.
    deadline = time.monotonic() + timeout
    while True:
        try:
            return consumer.get_watermark_offsets(tp, timeout=5.0)[1]
        except KafkaException:
            if time.monotonic() > deadline:
                raise
            time.sleep(0.5)


def drain(consumer: Consumer, timeout: float = 0.0, max_records: int = 10_000) -> Iterator[tuple[str, str]]:
    """Yield (topic, value) for every record available within `timeout`."""
    deadline = time.monotonic() + timeout
    count = 0
    while count < max_records:
        msg = consumer.poll(max(0.0, deadline - time.monotonic()))
        if msg is None:
            return
        if msg.error():
            raise KafkaException(msg.error())
        count += 1
        yield msg.topic(), msg.value().decode("utf-8")


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="Kafka helpers for the Flink decay/baseline job (Backlog B.1).")
    parser.add_argument("command", choices=("ensure-topics", "publish-lambdas"))
    parser.add_argument("--bootstrap-servers", default=DEFAULT_BOOTSTRAP)
    args = parser.parse_args(argv)
    ensure_topics(args.bootstrap_servers)
    if args.command == "publish-lambdas":
        count = publish_lambdas(make_producer(args.bootstrap_servers), ProtocolDecayRegistry())
        print(f"published {count} lambda_p record(s) to {LAMBDAS_TOPIC}")
    else:
        print("topics ready")


if __name__ == "__main__":
    main()
